
import * as mqtt from "mqtt"

import { MqttPlugin } from ".";
import { current } from "../../hypervisor/current";
import { get_plugin } from "../../runtime/hooks";
import { notePluginAnnotation, pluginAnnotationDecorator } from "../base";

type Unsubscriber = () => void;
type MqttMessageHandler<T = any> = (topic: string, payload: string) => any;

export function mqttApi(options: { pluginId: string }) {
    const id = options.pluginId;

    // NB Each application has it's own connection to the broker.
    // Otherwise we'd either need to NEVER usubscribe anything, OR we'd need to implement subscription counting logic... that takes wildcards into account.
    // Since there's no shared state between apps, we can just discard the connection and not have to worry about creating individual cleanups

    // TODO If id==default && plugin is null, warn
    const _plugin = () => get_plugin<MqttPlugin>(id);
    const _connection = () => _plugin().instanceConnection(current.instance);

    function listen(topic: string, options: mqtt.IClientSubscribeOptions, handler: MqttMessageHandler) {
        const conn = _connection();
        conn.subscribe(topic, options);
        const wrappedHandler = (topic, payload, packet) => {
            // TODO Does topic match
            const spayload = payload.toString();
            handler(topic, spayload);
        }
        conn.on("message", wrappedHandler);
        return () => {
            conn.off("message", wrappedHandler);
        }
    }

    function subscribe(topic: string, callback: MqttMessageHandler): Unsubscriber
    function subscribe(topic: string, options: mqtt.IClientSubscribeOptions, callback: MqttMessageHandler): Unsubscriber
    function subscribe(topic: string, options?: mqtt.IClientSubscribeOptions): (func, context: ClassMethodDecoratorContext<any, MqttMessageHandler>) => void
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

    // TODO function published_observable() {} :raised-eyebrow: ?
    //   Automatically apply @observable or @computed as needed

    return {
        _plugin,
        _connection,
        subscribe,
        publish,
    }
}

export type MqttApi = ReturnType<typeof mqttApi>;

export const api = {
    ...mqttApi({ pluginId: "mqtt" }),
    createInstance(...params: Parameters<typeof mqttApi>) {
        return mqttApi(...params);
    },
}
