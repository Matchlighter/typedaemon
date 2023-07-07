
import { action, observable, runInAction } from 'mobx'
import * as ws from "ws";
import {
    createConnection,
    getStates,
    StateChangedEvent,
    Connection,
    callService,
    HassServiceTarget,
    createLongLivedTokenAuth,
    HassEvent,
    ERR_CANNOT_CONNECT,
    ERR_CONNECTION_LOST,
    ERR_HASS_HOST_REQUIRED,
    ERR_INVALID_AUTH,
    ERR_INVALID_HTTPS_TO_HTTP,
    HassEntity,
    HassEntities,
} from 'home-assistant-js-websocket'

import { sync_to_observable } from '@matchlighter/common_library/sync_observable'

import { ResumablePromise, SerializedResumable } from "../../runtime/resumable";
import { HomeAssistantApi, homeAssistantApi } from './api';
import { get_plugin } from '../../runtime/hooks';
import { HomeAssistantPluginConfig, PluginType } from '../../hypervisor/config_plugin';
import { Plugin } from '../base';
import { HyperWrapper } from '../../hypervisor/managed_apps';
import { current } from '../../hypervisor/current';
import { DeepReadonly } from '../../common/util';

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

export class HomeAssistantPlugin extends Plugin<PluginType['home_assistant']> {
    readonly api: HomeAssistantApi = homeAssistantApi({ pluginId: this[HyperWrapper].id });

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

    async writeSOState(entity: string, state: any, attrs?: any) {
        // TODO Write the (eg) sensor state to HA
    }

    onConnected(callback: () => void)
    onConnected(when: OnConnectedWhen, callback: () => void)
    onConnected(arg1, arg2?) {

    }

    subscribe(callback: (event: HassEvent) => void) {

    }

    private readonly stateStore: any = observable({}, {}, { deep: false }) as any;
    get state(): DeepReadonly<HassEntities> { return this.stateStore }

    _ha_api: Connection;
    private pingInterval;

    awaitForEvent(pattern) {
        const app = current.application;
        return new EventAwaiter(this, pattern);
    }

    trackEventAwaiter(awaiter: EventAwaiter) {
        // TODO
        return () => {

        }
    }

    private async connect() {
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
            this._ha_api = ha;
        } catch (ex) {
            if (HA_WS_ERRORS[ex]) {
                throw new Error(`HA WebSocket Error: ${HA_WS_ERRORS[ex]}`);
            } else {
                throw ex;
            }
        }
        this.pingInterval = setInterval(() => {
            if (this._ha_api.connected) this._ha_api.ping();
        }, 30000)

        // Synchronize states
        await this.resyncStatesNow();
        this._ha_api.addEventListener("ready", () => this.resyncStatesNow());

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
            }

            // TODO Dispatch event to other listeners
        })
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
        this._ha_api.options.auth = createLongLivedTokenAuth(this.config.url, this.config.access_token);
        this._ha_api.reconnect();
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
        this.ha_untrack = this.hap.trackEventAwaiter(this);
    }

    serialize(): SerializedResumable {
        return {
            type: 'ha_event_waiter',
            sideeffect_free: true,
            plugin: this.hap[HyperWrapper].id,
            schema: this.schema,
        }
    }
}
