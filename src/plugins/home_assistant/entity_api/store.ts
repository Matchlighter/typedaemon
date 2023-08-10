import { TDEntity } from ".";
import type { HomeAssistantPlugin } from "..";
import { ApplicationInstance } from "../../../hypervisor/application_instance";
import { logMessage } from "../../../hypervisor/logging";
import { MqttPlugin } from "../../mqtt";

export class EntityStore {
    constructor(readonly plugin: HomeAssistantPlugin, readonly application: ApplicationInstance) {
        application.cleanups.append(() => this.cleanup());
        this.mqttPlugin = plugin.mqttPlugin();
    }

    private tracked_entities = new Set<TDEntity<any>>();

    private mqttPlugin: MqttPlugin;

    async registerEntity(entity: TDEntity<any>) {
        logMessage("debug", `Registering entity '${entity.id}'`)

        if (entity['_bound_store']) {
            throw new Error(`Entity ${entity.id} already registered!`)
        }

        entity['_bound_store'] = this;
        entity['_disposers'].prepend(() => {
            this._untrackEtity(entity)
            entity['_bound_store'] = null;
        })

        this.tracked_entities.add(entity);

        await entity['_register_in_ha']();
    }

    protected _untrackEtity(entity: TDEntity<any>) {
        this.tracked_entities.delete(entity);
    }

    mqttApi() {
        return this.plugin.mqttApi();
    }

    mqttConnection() {
        return this.mqttPlugin.instanceConnection(this.application);
    }

    cleanup() {
        // May not really be needed - marking the entities as `unavailable` will already be handled by the app status topic. All (current) event subscriptions are app-scoped
        const all_ents = [...this.tracked_entities];
        for (let ent of all_ents) {
            ent.unlink();
        }
    }
}
