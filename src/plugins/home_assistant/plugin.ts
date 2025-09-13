
import {
    Connection,
    ERR_CANNOT_CONNECT,
    ERR_CONNECTION_LOST,
    ERR_HASS_HOST_REQUIRED,
    ERR_INVALID_AUTH,
    ERR_INVALID_HTTPS_TO_HTTP,
    HassServiceTarget,
    MessageBase,
    createConnection as _createConnection,
    callService,
    createLongLivedTokenAuth
} from 'home-assistant-js-websocket';
import * as ws from "ws";
import objectHash = require('object-hash');

import { HAMobXStore } from '@matchlighter/ha-mobx-store';

import { logPluginClientMessage } from '../../hypervisor/logging';
import { HyperWrapper } from '../../hypervisor/managed_apps';
import { ResumablePromise } from "../../runtime/resumable";
import { CancellableResumablePromise, SerializeContext } from '../../runtime/resumable/resumable_promise';
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

    private _synced_store: HAMobXStore;

    get ha_config() { return this._synced_store.ha_config }
    get state() { return this._synced_store.get("state") }
    get devices() { return this._synced_store.get("device") }
    get areas() { return this._synced_store.get("area") }
    get labels() { return this._synced_store.get("label") }

    _ha_api: SubCountingConnection;
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

        let lastEvent;
        this.pingInterval = setInterval(() => {
            if (!lastEvent || lastEvent < Date.now() - 30000) {
                this[HyperWrapper].logMessage("warn", `No events received for 30s!`)
                this[HyperWrapper].logMessage("warn", this._ha_api.connected, this._ha_api.options, this._ha_api.oldSubscriptions);
                this[HyperWrapper].logMessage("warn", this._ha_api['subscription_counts']);
                this[HyperWrapper].logMessage("warn", this._ha_api);
            }
            if (this._ha_api.connected) this._ha_api.ping();
        }, 30000);

        this._synced_store = new HAMobXStore(this._ha_api);

        this._ha_api.subscribeMessage(() => {
            lastEvent = Date.now();
        }, { type: "subscribe_events" });

        this._ha_api.addEventListener("ready", () => {
            this[HyperWrapper].logMessage("info", `HA Websocket Ready`)
            this._ha_api.forceResubscribe();
        })
        this._ha_api.addEventListener("disconnected", () => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Disconnected`)
        })
        this._ha_api.addEventListener("reconnect-error", (conn, err) => {
            this[HyperWrapper].logMessage("warn", `HA Websocket Reconnect Error (${HA_WS_ERRORS[err] || err})`)
        })

        // TODO Await for the _synced_store before marking Plugin as ready
    }

    configuration_updated(new_config: HomeAssistantPluginConfig, old_config: HomeAssistantPluginConfig) {
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
