
import * as mqtt from "mqtt";

import { ApplicationInstance } from "../../hypervisor/application_instance";
import { MQTTPluginConfig, PluginType } from "../../hypervisor/config_plugin";
import { BaseInstance, HyperWrapper } from "../../hypervisor/managed_apps";
import { Plugin } from "../base";
import { SUPERVISOR_API } from "../supervisor";
import { mqttApi } from "./api";
import './mqtt_patches';

type ExtMqttClient = mqtt.MqttClient & { shutdown: () => Promise<any> };

export class MqttPlugin extends Plugin<PluginType['mqtt']> {
    readonly api = mqttApi({ pluginId: this[HyperWrapper].id });

    private ownConnection: ExtMqttClient;
    private applicationConnections = new Map<BaseInstance<any>, ExtMqttClient>()

    instanceConnection(instance: BaseInstance<any>) {
        if (this[HyperWrapper].state != 'started') {
            throw new Error("Attempt to start an MQTT connection after shutdown!")
        }

        if (instance == this[HyperWrapper]) {
            return this.ownConnection;
        } else {
            if (this.applicationConnections.has(instance)) {
                return this.applicationConnections.get(instance);
            } else {
                const conn = this.createConnection("App:" + instance.id, `${this.getApplicationTopic(instance as ApplicationInstance)}/status`);
                this.applicationConnections.set(instance, conn);

                let cleanedup = false;
                const cleanup = async () => {
                    if (cleanedup) return;
                    await conn.shutdown();
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

    get root_topic() {
        return this.config.base_topic || "td";
    }

    getApplicationTopic(app: ApplicationInstance) {
        return `${this.root_topic}/applications/${app.uuid}`;
    }

    private supervisorServiceConfig: any = {};

    private resolveConnectionConfig(cfg = this.config) {
        return {
            host: cfg.host || this.supervisorServiceConfig?.host,
            // port: this.supervisorServiceConfig?.port,
            username: cfg.username || this.supervisorServiceConfig?.username,
            password: cfg.password || this.supervisorServiceConfig?.password,
        }
    }

    protected createConnection(name: string, status_topic?: string): ExtMqttClient {
        const inst = this[HyperWrapper];
        const uid = Math.random().toString(16).substr(2, 8);
        status_topic ||= `${this.root_topic}/${uid}/status`

        const client = mqtt.connect(this.config.url, {
            clientId: `typedaemon|${uid}|${inst.id}|${name}`,

            ...this.resolveConnectionConfig(),

            will: {
                topic: status_topic,
                payload: "offline",
                qos: 0,
                retain: false,
            },
        });

        // Avoid re-logging duplicate traces while reconnecting
        let last_message;

        client.on("connect", () => {
            last_message = null;
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Connected!`)
            client.publish(status_topic, "online", {
                retain: true,
            })
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
            // let log_line: any = err;
            // if (String(err) == last_message) log_line = err.message;
            // last_message = String(err);

            this[HyperWrapper].logMessage("error", `MQTT (${name}) Error:`, err);
        })

        Object.assign(client, {
            shutdown: async () => {
                client.publish(status_topic, "offline", {
                    retain: true,
                })
                await new Promise((resolve, reject) => {
                    client.end(false, {}, resolve);
                })
            },
        })

        return client as any;
    }

    async initialize() {
        if (SUPERVISOR_API && !((this.config.host && this.config.username && this.config.password) || this.config.url)) {
            try {
                this.supervisorServiceConfig = (await SUPERVISOR_API.get("services/mqtt")).data?.data;
            } catch (ex) {
                this[HyperWrapper].logMessage("warn", `Supervisor configured, but failed to fetch MQTT Service info.`, ex);
            }
        }

        this.ownConnection = this.createConnection("PLUGIN", `${this.root_topic}/status`);

        this.addCleanup(() => {
            if (this.ownConnection) {
                return this.ownConnection.shutdown();
            }
        })

        await new Promise((resolve, reject) => {
            this.ownConnection.once("connect", () => resolve(undefined));
        })
    }

    configuration_updated(new_config: MQTTPluginConfig, old_config: MQTTPluginConfig) {
        for (let conn of [this.ownConnection, ...this.applicationConnections.values()]) {
            Object.assign(conn.options, this.resolveConnectionConfig(new_config));
            conn.reconnect();
        }
    }
}
