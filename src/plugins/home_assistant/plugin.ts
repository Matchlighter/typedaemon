import { ENTITY_STATE_KEY_PREFIX } from "./storage_keys";

import {
    Connection,
    ERR_CANNOT_CONNECT,
    ERR_CONNECTION_LOST,
    ERR_HASS_HOST_REQUIRED,
    ERR_INVALID_AUTH,
    ERR_INVALID_HTTPS_TO_HTTP,
    MessageBase,
    createConnection as _createConnection,
    callService,
    getConfig,
    createLongLivedTokenAuth
} from 'home-assistant-js-websocket';
import * as ws from "ws";
import objectHash from 'object-hash';

import { HAMobXStore } from '@matchlighter/ha-mobx-store';
import { comparer, reaction, toJS } from 'mobx';
import { TypedEmitter } from 'tiny-typed-emitter';

import type { ApplicationInstance } from '../../hypervisor/application_instance';
import type { PersistentStorage } from '../../hypervisor/persistent_storage';
import { logPluginClientMessage } from '../../hypervisor/logging';
import { HyperWrapper } from '../../hypervisor/managed_apps';
import { ResumablePromise } from "../../runtime/resumable";
import { CancellableResumablePromise, SerializeContext } from '../../runtime/resumable/resumable_promise';
import { startHeartbeat } from './heartbeat';
import { internal_sleep } from '../../util';
import { Plugin, get_plugin, handle_client_error, type PluginConnectionState } from '../base';
import { MqttPlugin } from '../mqtt/plugin';
import { HomeAssistantApi, homeAssistantApi } from './api';
import { EntityTypesConfig, HassEntityServiceTarget, syncEntityTypes } from './entity_ids';
import { autoCleanEntitiesKey, destroyUnlinkedEntity } from './entity_api/auto_cleaning';
import { pickHaBaseUrl } from './base_url';
import { listEntityRows, type AppEntityInfo, type EntityStateInfo } from './entity_api/inspect';
import { EntityStore } from './entity_api/store';

// @ts-ignore
global.WebSocket ||= ws.WebSocket

const HA_WS_ERRORS = {
    [ERR_CANNOT_CONNECT]: "ERR_CANNOT_CONNECT",
    [ERR_CONNECTION_LOST]: "ERR_CONNECTION_LOST",
    [ERR_HASS_HOST_REQUIRED]: "ERR_HASS_HOST_REQUIRED",
    [ERR_INVALID_AUTH]: "ERR_INVALID_AUTH",
    [ERR_INVALID_HTTPS_TO_HTTP]: "ERR_INVALID_HTTPS_TO_HTTP",
}

interface CountedSubscription {
    message: MessageBase;
    callbacks: Set<(...args: any[]) => void>;
    unsubscribe: () => any;
}
export class SubCountingConnection extends Connection {
    private subscription_counts: Record<string, CountedSubscription> = {};

    private async createCounterSubscription(counter: CountedSubscription) {
        const unsubscribe = await super.subscribeMessage((...args) => {
            for (let h of counter.callbacks) {
                try {
                    const result = h(...args) as any;
                    if (result && "then" in result) {
                        result.catch(handle_client_error);
                    }
                } catch (ex) {
                    handle_client_error(ex);
                }
            }
        }, counter.message, { resubscribe: true });

        counter.unsubscribe = unsubscribe;
    }

    async subscribeMessage<Result>(callback: (result: Result) => void, subscribeMessage: MessageBase, options?: { resubscribe?: boolean; }): Promise<() => Promise<void>> {
        const hash_key = objectHash(subscribeMessage);

        // TODO Support resubscribe: false? Use case?

        let counter = this.subscription_counts[hash_key];
        if (!counter) {
            counter = this.subscription_counts[hash_key] = {
                message: { ...subscribeMessage },
                callbacks: new Set(),
                unsubscribe: null,
            }

            logPluginClientMessage(this, "debug", "New HA Subscription:", subscribeMessage);

            await this.createCounterSubscription(counter);
        }

        counter.callbacks.add(callback);

        return async () => {
            counter.callbacks.delete(callback);
            if (counter.callbacks.size == 0) {
                logPluginClientMessage(this, "debug", "Closing HA Subscription:", subscribeMessage);
                delete this.subscription_counts[hash_key];
                await counter.unsubscribe();
            }
        }
    }

    async forceResubscribe() {
        for (let counter of Object.values(this.subscription_counts)) {
            try {
                await counter.unsubscribe();
            } catch (ex) {
                // ignore
            }
            await this.createCounterSubscription(counter);
        }
    }
}
const createConnection: typeof _createConnection = async (...args) => {
    const conn = await _createConnection(...args) as any as SubCountingConnection;
    Object.setPrototypeOf(conn, SubCountingConnection.prototype);
    conn['subscription_counts'] = {};
    return conn;
}

export interface HomeAssistantPluginConfig {
    type: "home_assistant";
    url: string;
    access_token: string;
    mqtt_plugin?: string;

    /**
     * Generate types of the entity IDs in Home Assistant (`HassEntityIds`, `HassSensorIds`, ...).
     * Enabled (for all entities) by default; set to `false` to disable.
     */
    entity_types?: EntityTypesConfig | false;
}

export class HomeAssistantPlugin extends Plugin<HomeAssistantPluginConfig> {
    readonly api: HomeAssistantApi = homeAssistantApi(this);

    async initialize() {
        await this.connect();
    }

    async shutdown() {
        this.stopEntityTypes?.();
        this._ha_api?.close();
        this.heartbeat?.stop();
    }

    private stopEntityTypes: () => void;
    private startEntityTypes() {
        this.stopEntityTypes?.();
        this.stopEntityTypes = null;
        if (this.config.entity_types === false) return;
        this.stopEntityTypes = syncEntityTypes(this, this.config.entity_types || {});
    }

    async request(type: string, parameters: any) {
        return await this._ha_api.sendMessagePromise({
            type,
            ...parameters,
        })
    }

    async sendMessage(type: string, parameters: any) {
        return this._ha_api.sendMessage({ type, ...parameters });
    }

    async callService(serviceStr: string, data: any, target?: HassEntityServiceTarget) {
        const [domain, service] = serviceStr.split('.')
        return await callService(this._ha_api, domain, service, data, target);
    }

    /** Fires when an app's tracked entities change (not for state changes - see `observeAppEntities`) */
    readonly entityEvents = new TypedEmitter<{ change: (app: ApplicationInstance) => void }>();

    /** Entities `app` has registered here (linked) plus the ones only its autoclean registry remembers (unlinked) */
    appEntities(app: ApplicationInstance): AppEntityInfo[] {
        const storage = app.persistedStorage;
        // Storage is loaded early in the app's startup; before that there is nothing to know
        if (!storage) return [];
        return this.entityRows(storage, EntityStore.peek(this, app));
    }

    /** The entities remembered in an app's store, none of them linked: for an app that is not running (an orphan) */
    storedEntities(storage: PersistentStorage): AppEntityInfo[] {
        return this.entityRows(storage, undefined);
    }

    private entityRows(storage: PersistentStorage, store: EntityStore | undefined): AppEntityInfo[] {
        const tracked = [...(store?.tracked_entities ?? [])].map((e: any) => ({ uuid: e.uuid as string, domain: e.domain as string, entity_kind: e.entity_kind as string | undefined, name: e.name as string | undefined }));
        return listEntityRows({
            pluginId: this[HyperWrapper].id,
            tracked,
            registry: storage.getValue(autoCleanEntitiesKey(this)) ?? {},
            haEntities: (this._synced_store?.get("entity") ?? {}) as any,
            haStates: (this._synced_store?.get("state") ?? {}) as any,
            persistedStateUuids: new Set(storage.keys.filter(k => k.startsWith(ENTITY_STATE_KEY_PREFIX)).map(k => k.slice(ENTITY_STATE_KEY_PREFIX.length))),
        });
    }

    /** Call `cb` whenever `appEntities(app)` may have changed (tracking, registry, HA state). Returns a disposer. */
    observeAppEntities(app: ApplicationInstance, cb: () => void): () => void {
        const onEntities = (a: ApplicationInstance) => { if (a === app) cb() };
        this.entityEvents.on('change', onEntities);

        const registryKey = autoCleanEntitiesKey(this);
        const onStorage = (c: { key: string }) => { if (c.key === registryKey || c.key.startsWith(ENTITY_STATE_KEY_PREFIX)) cb() };
        const storage = app.persistedStorage;
        storage?.on('change', onStorage);

        // HA-side changes (state, entity_id assignment) arrive through the synced MobX store
        const offReaction = reaction(() => this.appEntities(app), () => cb(), { equals: comparer.structural });

        return () => {
            this.entityEvents.off('change', onEntities);
            storage?.off('change', onStorage);
            offReaction();
        };
    }

    /** HA's live state object of an entity (by entity_id), if it has one */
    entityState(entityId: string): EntityStateInfo | undefined {
        const st = this.state?.[entityId] as any;
        if (!st) return undefined;
        return { attributes: toJS(st.attributes ?? {}), lastChanged: st.last_changed, lastUpdated: st.last_updated };
    }

    /** Call `cb` whenever `entityState(entityId)` may have changed. Returns a disposer. */
    observeEntityState(entityId: string, cb: () => void): () => void {
        return reaction(() => this.entityState(entityId), () => cb(), { equals: comparer.structural });
    }

    /** Delete an unlinked entity (see `appEntities`) from HA and `app`'s autoclean registry. `cuid` = the registry key. */
    async deleteUnlinkedEntity(app: ApplicationInstance, cuid: string) {
        await destroyUnlinkedEntity(EntityStore.forApplication(this, app), cuid);
    }

    mqttPlugin() {
        return get_plugin(this.config.mqtt_plugin || "mqtt") as MqttPlugin;
    }

    mqttApi() {
        const pl = this.mqttPlugin();
        if (!pl) return null;
        return pl.api;
    }

    // onConnected(callback: () => void)
    // onConnected(when: OnConnectedWhen, callback: () => void)
    // onConnected(arg1, arg2?) {
    //     // TODO
    // }

    // subscribe(callback: (event: HassEvent) => void) {
    //     // TODO
    // }

    _synced_store: HAMobXStore;

    get ha_config() { return this._synced_store.ha_config }

    get state() { return this._synced_store.get("state") }

    get entities() { return this._synced_store.get("entity") }
    get devices() { return this._synced_store.get("device") }
    get floors() { return this._synced_store.get("floor") }
    get areas() { return this._synced_store.get("area") }
    get labels() { return this._synced_store.get("label") }

    private _connectionState: PluginConnectionState = 'disconnected';
    get connectionState() { return this._connectionState }
    get statusSummary() {
        if (this._connectionState !== 'connected' || !this._synced_store) return undefined;
        return [{ label: 'WebSocket', value: `subscribed · ${Object.keys(this.entities ?? {}).length} entities` }];
    }
    get connectionTarget() { return this.config.url || ('SUPERVISOR_TOKEN' in process.env ? "http://supervisor/core" : undefined) }

    private _haBaseUrl: string | undefined;
    /** Where a browser can open HA (see `pickHaBaseUrl`); known once connected, refreshed on every reconnect */
    get haBaseUrl() { return this._haBaseUrl }

    private async refreshBaseUrl() {
        const config = await getConfig(this._ha_api).catch(() => undefined);
        const url = pickHaBaseUrl(config, this.config.url);
        if (url === this._haBaseUrl) return;
        this._haBaseUrl = url;
        this.connectionChanged();
    }

    private setConnectionState(state: PluginConnectionState) {
        if (this._connectionState === state) return;
        this._connectionState = state;
        this.connectionChanged();
    }

    _ha_api: SubCountingConnection;
    private heartbeat: ReturnType<typeof startHeartbeat>;

    // awaitForEvent(pattern) {
    //     const app = current.application;
    //     return new EventAwaiter(this, pattern);
    // }

    protected trackEventAwaiter(awaiter: EventAwaiter) {
        // TODO
        return () => {

        }
    }

    private async connect() {
        while (true) {
            let url = this.config.url;
            let access_token = this.config.access_token;

            if ('SUPERVISOR_TOKEN' in process.env) {
                url ||= "http://supervisor/core"
                access_token ||= process.env['SUPERVISOR_TOKEN']
            }

            try {
                const ha = await createConnection({
                    auth: createLongLivedTokenAuth(url, access_token),
                })
                ha[HyperWrapper] = this[HyperWrapper];
                this._ha_api = ha as any;
                break;
            } catch (ex) {
                if (HA_WS_ERRORS[ex]) {
                    this[HyperWrapper].logMessage("error", `Could not connect to Home Assistant (${HA_WS_ERRORS[ex]}). Retrying in 30s...`);
                    await internal_sleep(30_000);
                } else {
                    throw ex;
                }
            }
        }

        this.heartbeat = startHeartbeat({
            ping: () => this._ha_api.ping(),
            isConnected: () => this._ha_api.connected,
            onDead: () => {
                this[HyperWrapper].logMessage("warn", `No pong from Home Assistant; reconnecting`);
                this._ha_api.reconnect(true);
            },
        });

        this._synced_store = new HAMobXStore(this._ha_api);
        this._synced_store.enableEntityIndex();
        this.startEntityTypes();
        this.addCleanup(reaction(() => Object.keys(this.entities ?? {}).length, () => this.connectionChanged()));

        this._ha_api.subscribeMessage(() => {
            this.heartbeat.touch();
        }, { type: "subscribe_events" });

        this.setConnectionState('connected');
        void this.refreshBaseUrl();
        this.addCleanup(() => this.setConnectionState('disconnected'));

        this._ha_api.addEventListener("ready", () => {
            this[HyperWrapper].logMessage("info", `HA Websocket Ready`)
            this.setConnectionState('connected');
            void this.refreshBaseUrl();
            this._ha_api.forceResubscribe();
        })
        this._ha_api.addEventListener("disconnected", () => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Disconnected`)
            // The library keeps retrying on its own
            this.setConnectionState('reconnecting');
        })
        this._ha_api.addEventListener("reconnect-error", (conn, err) => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Reconnect Error (${HA_WS_ERRORS[err] || err})`)
            this.setConnectionState('reconnecting');
        })

        // TODO Await for the _synced_store before marking Plugin as ready
    }

    reconnect() {
        if (!this._ha_api) throw new Error('Home Assistant is not connected yet; nothing to reconnect');
        this._ha_api.reconnect(true);
    }

    configuration_updated(new_config: HomeAssistantPluginConfig, old_config: HomeAssistantPluginConfig) {
        if (this._synced_store) this.startEntityTypes();
        if (this._ha_api) {
            this._ha_api.options.auth = createLongLivedTokenAuth(this.config.url, this.config.access_token);
            this._ha_api.reconnect();
        }
    }
}

class EventAwaiter extends CancellableResumablePromise<any> {
    constructor(readonly hap: HomeAssistantPlugin, readonly schema) {
        super();
        this.do_unsuspend();
    }

    static {
        ResumablePromise.defineClass({
            type: 'ha_event_waiter',
            resumer: (data) => {
                const { plugin, schema } = data;
                const ha = get_plugin<HomeAssistantPlugin>(plugin);
                return new this(ha, schema);
            },
        })
    }

    private ha_untrack: () => void;

    protected do_suspend(): void {
        this.ha_untrack?.();
    }

    protected do_unsuspend(): void {
        this.ha_untrack = this.hap['trackEventAwaiter'](this);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type('ha_event_waiter');
        ctx.side_effects(false);
        return {
            plugin: this.hap[HyperWrapper].id,
            schema: this.schema,
        }
    }
}
