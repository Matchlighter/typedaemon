
import { HassEntity, HassEvent, MessageBase, StateChangedEvent } from "home-assistant-js-websocket";

import "@matchlighter/common_library/decorators/20223fills";

import { HomeAssistantPlugin } from ".";
import { escapeRegExp } from "../../common/util";
import { current } from "../../hypervisor/current";
import { callback_or_decorator2 } from "../../util";
import { assert_application_context, bind_callback_env, makeApiExport, notePluginAnnotation, pluginGetterFactory } from "../base";
import { _entitySubApi } from "./api_entities";
import { TDDevice } from "./entity_api";

export interface FullState<V> {
    state: V;
    [key: string]: any;
}

type WebhookMethods = "GET" | "POST" | "PUT" | "HEAD";
type WebhookPayload<T = any> = {
    payload: T,
    headers: Record<string, string>,
    params: Record<string, string>,
}

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, homeAssistantApi.defaultPluginId);

    const { registerEntity, entities, input } = _entitySubApi(_plugin)

    // ========= Service Helpers ========= //

    function callService(...params: Parameters<HomeAssistantPlugin['callService']>) {
        return _plugin().callService(...params);
    }

    async function toggleSwitch(ent: HassEntity) {
        let domain = 'homeassistant';
        const group = ent.entity_id.split('.')[0];

        if (['switch', 'light', 'fan'].indexOf(group) !== -1) {
            domain = group;
        }

        let service = 'toggle';

        if (ent.state === 'off') {
            service = 'turn_on';
        } else if (ent.state === 'on') {
            service = 'turn_off';
        }

        return await callService(`${domain}.${service}`, { entity_id: ent.entity_id })
    }

    // async function findRelatedDevices(entity: HassEntity) {
    //     // TODO
    // }

    async function findRelatedEntities(entity: HassEntity): Promise<string[]> {
        const pl = _plugin();
        const response1: any = await pl.request('search/related', { item_type: 'entity', item_id: entity.entity_id });
        const relatedDeviceIds = response1['device'];
        if (!relatedDeviceIds) return [];
        // const response2: any = await pl.request('search/related', { item_type: 'device', item_id: relatedDeviceIds[0] });
        // return response2['entity'] || [];
        return response1['entity'] || [];
    }

    function _sync_subscribe(message: MessageBase, callback: (value) => void) {
        assert_application_context();

        let disposed = false;
        let disposer;

        _plugin()._ha_api.subscribeMessage(callback, message, { resubscribe: true }).then(disp => {
            if (disposer) disposer();
            if (disposed) {
                disp();
            } else {
                disposer = disp;
            }
        }, (err) => {
            console.error("Error subscribing", message, err)
        })

        const cleanups = current.application.cleanups.unorderedGroup("ha:subscriptions");
        return cleanups.addExposed(async () => {
            if (disposer) await disposer();
            disposer = null;
            disposed = true;
        })
    }

    /**
     * Start a websocket subscription with Home Assistant
     * 
     * Basically a passthrough of `subscribeMessage` from `home-assistant-js-websocket`
     */
    function subscribe_message<T>(msg: MessageBase) {
        function executor(callback: (payload: T) => void)
        function executor(target, context: ClassMethodDecoratorContext<any, (payload: T) => void>)
        function executor(target, context?: ClassMethodDecoratorContext) {
            if (context) {
                notePluginAnnotation(context, (self) => {
                    executor((payload) => {
                        self[context.name](payload);
                    })
                });
            } else {
                _sync_subscribe(msg, bind_callback_env(target));
            }
        }
        return executor;
    }

    const subscribe_events = callback_or_decorator2((f: (event: HassEvent) => void, event_type: string | string[]) => {
        f = bind_callback_env(f);

        if (!Array.isArray(event_type)) event_type = [event_type];
        const event_types_set = new Set(event_type);

        // TODO Should we have HA filter the event_type, or do it in the callback?
        //   If we do it in the callback, we end up just using the cached/global subscription instead of creating a second
        return _sync_subscribe({ type: "subscribe_events" }, (evt: HassEvent) => {
            if (event_types_set.has(evt.event_type) || event_type == '*') {
                f(evt);
            }
        })
    });

    const subscribe_state = callback_or_decorator2((f: (new_state: HassEntity, old_state: HassEntity, entity_id: string) => void, entity: string | string[] | RegExp) => {
        f = bind_callback_env(f);

        let match: (evt: StateChangedEvent) => boolean;
        if (typeof entity == 'string') {
            if (entity == "*") {
                match = () => true;
            } else if (entity.endsWith(".*")) {
                const [domain] = entity.split('.');
                const prefix = domain + ".";
                match = (evt) => evt.data.entity_id.startsWith(prefix);
            } else if (entity.includes("*")) {
                let pattern = entity;
                pattern = escapeRegExp(pattern);
                pattern = pattern.replace(/\\\*/g, "\\w*");
                pattern = `^${pattern}$`;
                const regex = new RegExp(pattern);
                match = (evt) => !!evt.data.entity_id.match(regex);
            } else {
                match = (evt) => evt.data.entity_id == entity;
            }
        } else if (Array.isArray(entity)) {
            const ent_set = new Set(entity);
            match = (evt) => ent_set.has(evt.data.entity_id);
        } else if (entity instanceof RegExp) {
            match = (evt) => !!evt.data.entity_id.match(entity);
        }

        // TODO Should we have HA filter the event_type, or do it in the callback?
        //   If we do it in the callback, we end up just using the cached/global subscription instead of creating a second
        return _sync_subscribe({ type: "subscribe_events" }, (evt: StateChangedEvent) => {
            if (evt.event_type == "state_changed" && match(evt)) {
                f(evt.data.new_state, evt.data.old_state, evt.data.entity_id);
            }
        })
    });

    /**
     * Create a Home Assistant Webhook with the given ID. Will be available at http(s)://<Your HA URL>/api/webhook/<ID>.
     * 
     * Requires https://github.com/zachowj/hass-node-red/tree/main
     */
    function webhook<T>(id: string, options?: { allowed_methods?: WebhookMethods[], name?: string }) {
        function webhook_executor(callback: (payload: WebhookPayload<T>) => void)
        function webhook_executor(target, context: ClassMethodDecoratorContext<any, (payload: WebhookPayload<T>) => void>)
        function webhook_executor(target, context?: ClassMethodDecoratorContext) {
            if (context) {
                notePluginAnnotation(context, (self) => {
                    _sync_subscribe({
                        type: "nodered/webhook",
                        server_id: "not used",
                        name: options?.name || context.name || id,
                        webhook_id: id,
                        allowed_methods: options?.allowed_methods || ['GET'],
                    }, (payload) => {
                        self[context.name](payload?.data);
                    })
                });
            } else {
                _sync_subscribe({
                    type: "nodered/webhook",
                    server_id: "not used",
                    name: options?.name || id,
                    webhook_id: id,
                    allowed_methods: options?.allowed_methods || ['GET'],
                }, (payload) => target(payload?.data))
            }
        }

        return webhook_executor;
    }

    const _mqttApi = () => _plugin().mqttApi();

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        /**
         * Returns the underlying Connection object from `home-assistant-js-websocket`.
         * This is advanced usage and should only be used if you know what you're doing.
         * You MUST handle disposal of any subscriptions or objects returned.
         */
        _getConnection: () => _plugin()._ha_api,
        /**
         * Returns the underlying Connection object from `home-assistant-js-websocket`.
         * This is advanced usage and should only be used if you know what you're doing.
         * You MUST handle disposal of any subscriptions or objects returned.
         */
        get _connection() { return _plugin()._ha_api },

        get states() { return _plugin().state },

        subscribe_message,
        subscribe_events,
        subscribe_state,
        webhook,

        mqtt: {
            get api() { return _mqttApi() },
            get typedaemon_topic() {
                return _mqttApi().system_topic;
            },
            get application_topic() {
                return _mqttApi().application_topic;
            },
        },

        get application_device(): Readonly<TDDevice> {
            const app = current.application;
            return {
                name: app.options?.human_name || `TypeDaemon - ${app.id}`,
                manufacturer: "TypeDaemon",
                connections: [
                    ["td_app", app.uuid],
                ],
                identifiers: [
                    `td-${app.uuid}`,
                ],
            }
        },

        registerEntity,
        entity: entities,
        input,
        button: input.button,
        callService,
        findRelatedEntities,
        // findRelatedDevices,
        toggleSwitch,
    }
}
homeAssistantApi.defaultPluginId = "home_assistant";

export type HomeAssistantApi = ReturnType<typeof homeAssistantApi>;

export const api = makeApiExport(homeAssistantApi)
