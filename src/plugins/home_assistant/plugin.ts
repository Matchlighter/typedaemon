
import {
    Connection,
    ERR_CANNOT_CONNECT,
    ERR_CONNECTION_LOST,
    ERR_HASS_HOST_REQUIRED,
    ERR_INVALID_AUTH,
    ERR_INVALID_HTTPS_TO_HTTP,
    HassConfig,
    HassEntities,
    HassEvent,
    HassServiceTarget,
    MessageBase,
    StateChangedEvent,
    createConnection as _createConnection,
    callService,
    createLongLivedTokenAuth,
    getConfig,
    getStates
} from 'home-assistant-js-websocket';
import { action, observable, runInAction } from 'mobx';
import * as ws from "ws";
import objectHash = require('object-hash');

import { sync_to_observable } from '@matchlighter/common_library/sync_observable';

import { DeepReadonly } from '../../common/util';
import { logPluginClientMessage } from '../../hypervisor/logging';
import { HyperWrapper } from '../../hypervisor/managed_apps';
import { ResumablePromise } from "../../runtime/resumable";
import { SerializeContext } from '../../runtime/resumable/resumable_promise';
import { internal_sleep } from '../../util';
import { Plugin, get_plugin, handle_client_error } from '../base';
import { MqttPlugin } from '../mqtt/plugin';
import { HomeAssistantApi, homeAssistantApi } from './api';

// @ts-ignore
global.WebSocket ||= ws.WebSocket

const HA_WS_ERRORS = {
    [ERR_CANNOT_CONNECT]: "ERR_CANNOT_CONNECT",
    [ERR_CONNECTION_LOST]: "ERR_CONNECTION_LOST",
    [ERR_HASS_HOST_REQUIRED]: "ERR_HASS_HOST_REQUIRED",
    [ERR_INVALID_AUTH]: "ERR_INVALID_AUTH",
    [ERR_INVALID_HTTPS_TO_HTTP]: "ERR_INVALID_HTTPS_TO_HTTP",
}

const STATE_SYNC_OPTS: Parameters<typeof sync_to_observable>[2] = {
    refs: ['$.*.context', '$.*.attributes.*'],
}

function isStateChangedEvent(event: HassEvent): event is StateChangedEvent {
    return event.event_type == "state_changed";
}

type OnConnectedWhen = 'always' | 'once' | 'once_per_host';

interface CountedSubscription {
    message: MessageBase;
    callbacks: Set<(...args: any[]) => void>;
    unsubscribe: () => any;
}
class SubCountingConnection extends Connection {
    private subscription_counts: Record<string, CountedSubscription> = {};

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
            }, subscribeMessage);

            counter.unsubscribe = unsubscribe;
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
}

interface HADevice {
    area_id;
    configuration_url;
    config_entries;
    connections;
    created_at;
    disabled_by;
    entry_type;
    hw_version;
    id;
    identifiers;
    labels;
    manufacturer;
    model;
    model_id;
    modified_at;
    name_by_user;
    name;
    primary_config_entry;
    serial_number;
    sw_version;
    via_device_id;
}

interface HAArea {
    aliases;
    area_id;
    floor_id;
    icon;
    labels;
    name;
    picture;
    created_at;
    modified_at;
}

interface HALabel {
    color;
    created_at;
    description;
    icon;
    label_id;
    name;
    modified_at;
}

export class HomeAssistantPlugin extends Plugin<HomeAssistantPluginConfig> {
    readonly api: HomeAssistantApi = homeAssistantApi(this);

    async initialize() {
        await this.connect();
    }

    async shutdown() {
        this._ha_api?.close();
        clearInterval(this.pingInterval);
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

    async callService(serviceStr: string, data: any, target?: HassServiceTarget) {
        const [domain, service] = serviceStr.split('.')
        return await callService(this._ha_api, domain, service, data, target);
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

    private readonly haConfigStore: any = {};
    get ha_config(): DeepReadonly<HassConfig> { return this.haConfigStore }

    private readonly stateStore: any = observable({}, {}, { deep: false }) as any;
    get state(): DeepReadonly<HassEntities> { return this.stateStore }

    private readonly deviceStore: any = observable({}, {}, { deep: false }) as any;
    get devices(): DeepReadonly<HassEntities> { return this.deviceStore }

    private readonly areaStore: any = observable({}, {}, { deep: false }) as any;
    get areas(): DeepReadonly<HassEntities> { return this.areaStore }

    private readonly labelStore: any = observable({}, {}, { deep: false }) as any;
    get labels(): DeepReadonly<HassEntities> { return this.labelStore }

    _ha_api: Connection;
    private pingInterval;

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
                this._ha_api = ha;
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

        let lastEvent;
        this.pingInterval = setInterval(() => {
            if (!lastEvent || lastEvent < Date.now() - 30000) {
                this[HyperWrapper].logMessage("warn", `No events received for 30s!`)
            }
            if (this._ha_api.connected) this._ha_api.ping();
        }, 30000)

        this._ha_api.subscribeMessage(() => {
            lastEvent = Date.now();
        }, { type: "subscribe_events" })

        // Synchronize states
        await this.resyncStatesNow();

        this._ha_api.addEventListener("ready", () => this.resyncStatesNow());

        this._ha_api.addEventListener("ready", () => {
            this[HyperWrapper].logMessage("info", `HA Websocket Ready`)
        })
        this._ha_api.addEventListener("disconnected", () => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Disconnected`)
        })
        this._ha_api.addEventListener("reconnect-error", (conn, err) => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Reconnect Error (${HA_WS_ERRORS[err] || err})`)
        })

        // Listen for events
        this._ha_api.subscribeEvents((ev: HassEvent) => {
            if (isStateChangedEvent(ev)) {
                runInAction(() => {
                    const { entity_id, new_state } = ev.data;
                    const state = this.stateStore;
                    if (new_state) {
                        const target = state[entity_id] = state[entity_id] || observable({}, {}, { deep: false }) as any;
                        sync_to_observable(target, new_state, { ...STATE_SYNC_OPTS, currentPath: ['$', entity_id] });
                    } else {
                        delete state[entity_id];
                    }
                })
            } else if (ev.event_type == "core_config_updated") {
                this.syncConfigNow();
            } else if (ev.event_type == "device_registry_updated") {
                this.syncDevicesNow();
            } else if (ev.event_type == "area_registry_updated") {
                this.syncAreasNow();
            } else if (ev.event_type == "label_registry_updated") {
                this.syncLabelsNow();
            }
        });

        await this.syncConfigNow();
        await this.syncDevicesNow();
        await this.syncAreasNow();
        await this.syncLabelsNow();
    }

    @action
    private async syncConfigNow() {
        const cfg = await getConfig(this._ha_api);
        sync_to_observable(this.haConfigStore, cfg, { });
    }

    @action
    private async syncDevicesNow() {
        const devices = await this.request("config/device_registry/list", {}) as HADevice[];
        const indexed = {};
        for (let l of devices) {
            indexed[l.id] = l;
        }
        sync_to_observable(this.deviceStore, indexed, { });
    }

    @action
    private async syncAreasNow() {
        const areas = await this.request("config/area_registry/list", {}) as HAArea[];
        const indexed = {};
        for (let l of areas) {
            indexed[l.area_id] = l;
        }
        sync_to_observable(this.areaStore, indexed, { });
    }

    @action
    private async syncLabelsNow() {
        const labels = await this.request("config/label_registry/list", {}) as HALabel[];
        const indexed = {};
        for (let l of labels) {
            indexed[l.label_id] = l;
        }
        sync_to_observable(this.labelStore, indexed, { });
    }

    @action
    private async resyncStatesNow() {
        const ha_states = {};
        for (let ent of await getStates(this._ha_api)) {
            ha_states[ent.entity_id] = ent;
        }

        sync_to_observable(this.stateStore, ha_states, STATE_SYNC_OPTS);
    }

    configuration_updated(new_config: HomeAssistantPluginConfig, old_config: HomeAssistantPluginConfig) {
        if (this._ha_api) {
            this._ha_api.options.auth = createLongLivedTokenAuth(this.config.url, this.config.access_token);
            this._ha_api.reconnect();
        }
    }
}

class EventAwaiter extends ResumablePromise<any>{
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
