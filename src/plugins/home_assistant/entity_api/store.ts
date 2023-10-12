import { TDEntity } from ".";
import type { HomeAssistantPlugin } from "..";
import { ApplicationInstance } from "../../../hypervisor/application_instance";
import { logMessage } from "../../../hypervisor/logging";
import { MqttPlugin } from "../../mqtt";

export class EntityStore {
    constructor(readonly plugin: HomeAssistantPlugin, readonly application: ApplicationInstance) {
        this.mqttPlugin = plugin.mqttPlugin();
        this.mqttConnection(); // Force MQTT cleanup to run after store cleanup
        application.cleanups.append(() => this.cleanup());

        if (application.state == 'starting') {
            application.addLifeCycleHook("started", () => {
                // TODO Mark registered items and look for persisted entries that need to be destroyed.
            })
        }
    }

    private tracked_entities = new Set<TDEntity<any>>();

    private mqttPlugin: MqttPlugin;

    async registerEntity(entity: TDEntity<any>) {
        if (entity['_bound_store']) {
            throw new Error(`Entity ${entity.uuid} already registered!`)
        }

        entity['_bound_store'] = this;
        logMessage("debug", `Registering entity '${entity.uuid}'`)

        entity['_disposers'].prepend(() => {
            this._untrackEntity(entity)
            entity['_bound_store'] = null;
        })

        this.tracked_entities.add(entity);

        await entity['_register_in_ha']();
    }

    protected _untrackEntity(entity: TDEntity<any>) {
        this.tracked_entities.delete(entity);
    }

    mqttApi() {
        return this.plugin.mqttApi();
    }

    mqttConnection() {
        return this.mqttPlugin.instanceConnection(this.application);
    }

    get mqtt_system_topic() { return this.mqttPlugin.td_system_topic }
    get mqtt_application_topic() { return this.mqttPlugin.getInstanceTopic(this.application) }

    cleanup() {
        // May not really be needed - marking the entities as `unavailable` will already be handled by the app status topic. All (current) event subscriptions are app-scoped
        const all_ents = [...this.tracked_entities];
        for (let ent of all_ents) {
            ent.unlink();
        }
    }
}
