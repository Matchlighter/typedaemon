
import * as mqtt from "mqtt"
import mqtt_match = require('mqtt-match')

import { MqttPlugin } from ".";
import { current } from "../../hypervisor/current";
import { get_plugin } from "../../runtime/hooks";
import { pluginAnnotationDecorator, pluginGetterFactory } from "../base";

type Unsubscriber = () => void;
type MqttMessageHandler<T = any> = (topic: string, payload: string) => any;

const DEFAULT_ID = "mqtt";

export interface SubscribeOptions extends mqtt.IClientSubscribeOptions {
    format?: 'json' | boolean;
}

export function mqttApi(options: { pluginId: string }) {
    const id = options.pluginId;

    // NB Each application has it's own connection to the broker.
    // Otherwise we'd either need to NEVER usubscribe anything, OR we'd need to implement subscription counting logic... that takes wildcards into account.
    // Since there's no shared state between apps, we can just discard the connection and not have to worry about creating individual cleanups

    const _plugin = pluginGetterFactory<MqttPlugin>(options.pluginId, DEFAULT_ID);
    const _connection = () => _plugin().instanceConnection(current.instance);

    function listen(topic: string, options: SubscribeOptions, handler: MqttMessageHandler) {
        const conn = _connection();
        conn.subscribe(topic, options);
        const wrappedHandler = (rtopic, payload, packet) => {
            if (mqtt_match(topic, rtopic)) {
                let spayload = payload.toString();

                if (options?.format == 'json') {
                    spayload = JSON.parse(spayload)
                } else if (options?.format !== false) {
                    try {
                        spayload = JSON.parse(spayload)
                    } catch (ex) {}
                }

                handler(rtopic, spayload);
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
    ...mqttApi({ pluginId: DEFAULT_ID }),
    createInstance(...params: Parameters<typeof mqttApi>) {
        return mqttApi(...params);
    },
}
