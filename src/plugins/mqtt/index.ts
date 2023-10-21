
import * as mqtt from "mqtt";

import { ApplicationInstance } from "../../hypervisor/application_instance";
import { BaseInstance, HyperWrapper } from "../../hypervisor/managed_apps";
import { Plugin } from "../base";
import { SUPERVISOR_API } from "../supervisor";
import { mqttApi } from "./api";
import './mqtt_patches';

type ExtMqttClient = mqtt.MqttClient & { shutdown: () => Promise<any> };

export interface MQTTPluginConfig {
    type: "mqtt";
    system_topic?: string | false;
    url?: string;
    host?: string;
    username?: string;
    password?: string;
}

export class MqttPlugin extends Plugin<MQTTPluginConfig> {
    readonly api = mqttApi({ pluginId: this[HyperWrapper].id });

    private applicationConnections = new Map<BaseInstance<any>, ExtMqttClient>()

    private _ownConnection: ExtMqttClient;
    private establishOwnConnection() {
        this._ownConnection = this.createConnection("PLUGIN", `${this.td_system_topic}/status`);
    }
    private get ownConnection() {
        if (!this._ownConnection) this.establishOwnConnection();
        return this._ownConnection;
    }

    getInstanceTopic(app: ApplicationInstance) {
        return `${this.td_system_topic}/applications/${app.uuid}`;
    }

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
                const conn = this.createConnection("App:" + instance.id, `${this.getInstanceTopic(instance as ApplicationInstance)}/status`);
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

    get td_system_topic() {
        return this.config.system_topic || "td";
    }

    protected shouldSilenceSystem() {
        if (this.config.system_topic === false) return true;
        if (this.config.system_topic === null) return true;
        if (this.config.system_topic === "") return true;

        // If a system_topic was explicitly given, we don't need to be silent
        if (!!this.config.system_topic) return false;

        if (this[HyperWrapper].id == "mqtt") return false;

        // If we _know_ that this is the HA MQTT Server, we can default to making noise
        if (this.config.system_topic === undefined) {
            if (this.supervisorServiceConfig) {
                return false;
            }

            // Look at haConfig.mqtt_plugin as well
            const plcfgs = this[HyperWrapper]?.hypervisor?.currentConfig?.plugins || {};
            for (let [k, cfg] of Object.entries(plcfgs)) {
                if (cfg.type == "home_assistant" && cfg.mqtt_plugin == this[HyperWrapper].id) return false;
            }
        }

        // Otherwise, we default to silence so we don't publish anything automatically
        return true;
    }

    private supervisorServiceConfig: any;

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
        const publish_status = !this.shouldSilenceSystem();
        status_topic ||= `${this.td_system_topic}/${uid}/status`

        const client = mqtt.connect(this.config.url, {
            clientId: `typedaemon|${uid}|${inst.id}|${name}`,

            ...this.resolveConnectionConfig(),

            will: publish_status ? {
                topic: status_topic,
                payload: "offline",
                qos: 0,
                retain: false,
            } : null,
        });

        // Avoid re-logging duplicate traces while reconnecting
        let last_message;

        client.on("connect", () => {
            last_message = null;
            this[HyperWrapper].logMessage("debug", `MQTT (${name}) Connected!`)
            if (publish_status) {
                client.publish(status_topic, "online", {
                    retain: true,
                })
            }
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
                if (publish_status) {
                    client.publish(status_topic, "offline", {
                        retain: true,
                    })
                }
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

        // Own Connection is only needed if we need to publish Plugin status
        if (!this.shouldSilenceSystem()) {
            this.establishOwnConnection();
        }

        this.addCleanup(() => {
            return this.ownConnection?.shutdown();
        })

        if (this.ownConnection) {
            await new Promise((resolve, reject) => {
                this.ownConnection.once("connect", () => resolve(undefined));
            })
        }
    }

    configuration_updated(new_config: MQTTPluginConfig, old_config: MQTTPluginConfig) {
        for (let conn of [this.ownConnection, ...this.applicationConnections.values()]) {
            Object.assign(conn.options, this.resolveConnectionConfig(new_config));
            conn.reconnect();
        }
    }
}
