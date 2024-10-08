
import * as mqtt from "mqtt";
import mqtt_match = require('mqtt-match')

import { computed, observable } from "mobx";
import { MqttPlugin } from "./plugin";
import { current } from "../../hypervisor/current";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import { assert_application_context, bind_callback_env, client_call_safe, makeApiExport, notePluginAnnotation, pluginAnnotationDecorator } from "../base";
import { plgmobx } from "../mobx";

type Unsubscriber = () => void;
type MqttMessageHandler<T = any> = (topic: string, payload: string) => any;

export interface SubscribeOptions extends mqtt.IClientSubscribeOptions {
    format?: 'json' | boolean;
}

export function mqttApi(plugin_instace: MqttPlugin) {
    // NB Each application has it's own connection to the broker.
    // Otherwise we'd either need to NEVER usubscribe anything, OR we'd need to implement subscription counting logic... that takes wildcards into account.
    // Since there's no shared state between apps, we can just discard the connection and not have to worry about creating individual cleanups

    // TODO Support "bound" APIs where current.application is always the same
    const _plugin = () => plugin_instace;
    const _connection = () => {
        assert_application_context();
        return _plugin().instanceConnection(current.application);
    }

    function listen(topic: string, options: SubscribeOptions, handler: MqttMessageHandler) {
        const conn = _connection();
        conn.subscribe(topic, options);

        handler = bind_callback_env(handler);

        const wrappedHandler = (rtopic, payload, packet) => {
            if (mqtt_match(topic, rtopic)) {
                let spayload = payload.toString();

                if (options?.format == 'json') {
                    spayload = JSON.parse(spayload)
                } else if (options?.format !== false) {
                    try {
                        spayload = JSON.parse(spayload)
                    } catch (ex) { }
                }

                client_call_safe(handler, rtopic, spayload);
            }
        }
        conn.on("message", wrappedHandler);
        return () => {
            conn.off("message", wrappedHandler);
        }
    }

    function subscribe(topic: string, callback: MqttMessageHandler): Unsubscriber
    function subscribe(topic: string, options: SubscribeOptions, callback: MqttMessageHandler): Unsubscriber
    function subscribe(topic: string, options?: SubscribeOptions): (func, context: ClassMethodDecoratorContext<any, MqttMessageHandler>) => void
    function subscribe(topic, options?, callback?) {
        if (typeof options == 'function') {
            callback = options;
            options = {};
        }

        if (callback == null) {
            return pluginAnnotationDecorator<ClassMethodDecoratorContext>((ctx, self) => {
                const f = self[ctx.name];
                f['_td_mqtt_dispose'] = listen(topic, options, (...args) => f.call(self, ...args));
            })
        } else {
            listen(topic, options, callback);
        }
    }

    function publish(topic: string, message: string | number | object, options?: { qos?: mqtt.QoS, retain?: boolean, dup?: boolean }) {
        if (typeof message == 'object') message = JSON.stringify(message);
        message = String(message);
        _connection().publish(topic, message, options);
    }

    /**
     * Automatically publish the decorated getter/accessor to the given topic
     */
    function published(topic: string, options?: { qos?: mqtt.QoS, retain?: boolean, dup?: boolean }) {
        return <V>(target, context: ClassAccessorDecoratorContext<any, V> | ClassGetterDecoratorContext<any, V>) => {
            if (context.kind == 'getter') {
                const comptd = (computed as any)(target, context);

                notePluginAnnotation(context, (self) => {
                    plgmobx.autorun(self[HyperWrapper], () => {
                        const msg = client_call_safe(() => comptd.call(self));
                        publish(topic, msg, options);
                    })
                })

                return comptd;
            }

            if (context.kind == 'accessor') {
                const obsvd = (observable as any)(target, context);
                return {
                    ...obsvd,
                    set(value) {
                        publish(topic, value, options);
                        obsvd.set.call(this, value);
                    },
                }
            }
        }
    }

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        get system_topic() { return _plugin().td_system_topic },
        get application_topic() { return _plugin().getInstanceTopic(current.application) },

        /** Returns the underlying MqttClient instance from the MQTT library. This is advanced usage and should only be used if you know what you're doing */
        _getConnection: _connection,
        /** Returns the underlying MqttClient instance from the MQTT library. This is advanced usage and should only be used if you know what you're doing */
        get _connection() { return _connection() },

        subscribe,
        publish,
        published,
    }
}
mqttApi.defaultPluginId = "mqtt"

export type MqttApi = ReturnType<typeof mqttApi>;

export const api = makeApiExport(mqttApi);
