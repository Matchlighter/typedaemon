
import * as mqtt from "mqtt"

import { MQTTPluginConfig, PluginType } from "../../hypervisor/config_plugin";
import { BaseInstance, HyperWrapper } from "../../hypervisor/managed_apps";
import { Plugin } from "../base";
import { mqttApi } from "./api";

export class MqttPlugin extends Plugin<PluginType['mqtt']> {
    readonly api = mqttApi({ pluginId: this[HyperWrapper].id });

    private ownConnection: mqtt.MqttClient;
    private applicationConnections = new Map<BaseInstance<any>, mqtt.MqttClient>()

    instanceConnection(instance: BaseInstance<any>) {
        if (instance == this[HyperWrapper]) {
            return this.ownConnection;
        } else {
            if (this.applicationConnections.has(instance)) {
                return this.applicationConnections.get(instance);
            } else {
                const conn = this.createConnection();
                this.applicationConnections.set(instance, conn);
                instance.on("lifecycle", (state) => {
                    if (state == 'stopped' || state == 'dead') {
                        conn.end();
                        this.applicationConnections.delete(instance);
                    }
                })
                return conn;
            }
        }
    }

    protected createConnection(name?: string) {
        const inst = this[HyperWrapper];
        const uid = Math.random().toString(16).substr(2, 8);
        return mqtt.connect(this.config.url, {
            clientId: `typedaemon|${uid}|${inst.id}|${name}`,
            host: this.config.host,
            username: this.config.username,
            password: this.config.password,
            // will: {
            //     topic: "",
            //     payload: "",
            //     qos: 0,
            //     retain: false,
            // },
        });
    }

    async initialize() {
        this.ownConnection = this.createConnection();
    }

    async shutdown() {
        this.ownConnection?.end();
    }

    configuration_updated(new_config: MQTTPluginConfig, old_config: MQTTPluginConfig) {
        // TODO This plugin can implement a config reloader by just tweaking the username/password/url/host (conn.options) and `reconnect()`ing on all connections
        throw new Error("Method not implemented.");
    }
}
