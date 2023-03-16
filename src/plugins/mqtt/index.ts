
import * as mqtt from "mqtt";

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
                const conn = this.createConnection("App:" + instance.id);
                this.applicationConnections.set(instance, conn);

                let cleanedup = false;
                const cleanup = async () => {
                    if (cleanedup) return;
                    await new Promise((resolve, reject) => {
                        conn.end(false, {}, resolve);
                    })
                    this.applicationConnections.delete(instance);
                    cleanedup = true;
                }

                instance.cleanups.append(cleanup)
                instance.on("lifecycle", (state) => {
                    if (state == 'stopped' || state == 'dead') {
                        cleanup();
                    }
                })

                return conn;
            }
        }
    }

    protected createConnection(name?: string) {
        const inst = this[HyperWrapper];
        const uid = Math.random().toString(16).substr(2, 8);
        const client = mqtt.connect(this.config.url, {
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

        client.on("connect", () => {
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Connected!`)
        })

        client.on("disconnect", () => {
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Disconnected!`)
        })

        client.on("reconnect", () => {
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Reconnecting`)
        })

        client.on("end", () => {
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Destroyed!`)
        })

        client.on("error", (err) => {
            this[HyperWrapper].logMessage("error", `MQTT (${name}) Error:`, err);
        })

        return client;
    }

    async initialize() {
        this.ownConnection = this.createConnection("PLUGIN");
    }

    async shutdown() {
        if (this.ownConnection) {
            await new Promise((resolve, reject) => {
                this.ownConnection.end(false, {}, resolve);
            })
        }
    }

    configuration_updated(new_config: MQTTPluginConfig, old_config: MQTTPluginConfig) {
        for (let conn of [this.ownConnection, ...this.applicationConnections.values()]) {
            Object.assign(conn.options, {
                host: new_config.host,
                username: new_config.username,
                password: new_config.password,
            });
            conn.reconnect();
        }
    }
}
