import { observable } from "mobx";

import { ha } from "../..";
import { plgmobx } from "../../mobx";
import { TDDevice, TDEntity, resolveEntityId } from "./base";

// Will need to give some thought to unique_ids.
//   Likely use `<application unique_id (configurable) || application id>_<unique_id (configurable) || lowercase(undercore(name))>`
//   Will want an escape hatch where no interpolation is performed (when user prefixes it with a `/` or some other character?)
const resolveUUID = (uuid: string, ent: TDEntity<any>) => {
    if (uuid && uuid.startsWith('/')) return uuid.substring(1);

    const ent_bits = ent.id.split('.');
    const ent_did = ent_bits[ent_bits.length - 1]
    // uuid ||= ent_did;
    uuid ||= ent_bits.join('-');

    return `td-${ent['application'].uuid}-${uuid}`
}

export interface TDAbstractEntityOptions {
    device?: TDDevice,
    name?: string,
    /**
     * If for some reason you need to override the generated UUID, you can.
     * Should only be needed if you change your Entity ID or App ID, but needing to do so should be a rarity.
     * Prefix the value with a "/" to disable TD default interpolation of UUIDs
     */
    uuid?: string,

    /** Used instead of name for automatic generation of entity_id */
    object_id?: string;
}

abstract class TDAbstractEntity<T> extends TDEntity<T> {
    constructor(id: string, options?: TDAbstractEntityOptions) {
        super();

        this.id = resolveEntityId((this.constructor as any).domain, { id });

        this.name = options.name;

        // Device to default to an application-linked device
        this.device = options?.device || ha.application_device;

        this._uuid = options?.uuid;
        this.options ||= {};
    }

    readonly id: string;
    readonly options?: Readonly<TDAbstractEntityOptions>;

    private _uuid: string;
    private _abs_uuid: string;
    get uuid() {
        this._abs_uuid ||= resolveUUID(this._uuid, this);
        return this._abs_uuid;
    }

    /** Compute and return the current state value */
    abstract getState(): T;

    /** Compute and return any additional attributes */
    getExtraAttributes(): any {
        return {}
    }

    readonly name: string;
    protected readonly device: Readonly<TDDevice>;

    get domain() {
        return this.id.split('.')[0];
    }

    get domain_id() {
        return this.id.split('.')[1];
    }

    async markAvailable() {
        this.mqttConn.publish(`${this.mqtt_topic}/status`, "online", {
            retain: true,
        });
    }

    async markUnavailable() {
        this.mqttConn.publish(`${this.mqtt_topic}/status`, "offline", {
            retain: true,
        });
    }

    /** Completely remove the entity from HA */
    async _destroy() {
        const conn = this.mqttConn;

        // Remove from HA and cleanup MQTT topics
        const clear_topics = [
            `homeassistant/${this.domain}/${this.uuid}/config`,
            `${this.mqtt_topic}/status`,
            this.discovery_data().state_topic,
        ]
        for (let t of clear_topics) {
            conn.publish(t, null, {
                retain: true,
            });
        }
    }

    /** Mark the entity as unavailable in HA and remove any listeners. Called automatically when the app shuts down. */
    async _unlink() {
        this.markUnavailable();
    }

    protected async handle_service(payload: any) {
        // TODO Map services
        // TODO
    }

    protected get mqtt_topic() {
        return `${this._bound_store.mqtt_application_topic}/entities/${this.uuid}`;
    }

    get mqtt_state_topic() {
        return `${this.mqtt_topic}/stat`;
    }

    get mqtt_command_topic() {
        return `${this.mqtt_topic}/cmd`;
    }

    protected discovery_data() {
        return {
            availability: [
                { topic: `${this._bound_store.mqtt_system_topic}/status` }, // TD
                { topic: `${this._bound_store.mqtt_application_topic}/status` }, // App
                { topic: `${this.mqtt_topic}/status` }, // Entity
            ],

            availability_mode: "all",

            name: this.name,
            unique_id: this.uuid,
            object_id: this.options?.object_id || this.domain_id,

            state_topic: this.mqtt_state_topic,
            json_attributes_topic: this.mqtt_state_topic,
            value_template: "{{ value_json.state }}",
            json_attributes_template: "{{ value_json.attrs }}",

            command_topic: this.mqtt_command_topic,

            device: this.device,
        }
    }

    async reconfigure() {
        const mqtt = this._bound_store.mqttApi();
        const dd = this.discovery_data();
        mqtt.publish(`homeassistant/${this.domain}/${this.uuid}/config`, JSON.stringify(dd), {
            retain: true,
        });
    }

    // Make the entity discoverable. Use MQTT for MVP, possibly develop integration later
    protected async _register_in_ha() {
        const mqtt = await this._bound_store.mqttApi();
        if (!mqtt) throw new Error("HA Plugin not associated with an MQTT Plugin");

        // Dispatch MQTT Discovery message
        await this.reconfigure();

        // Listen for Commands
        this._disposers.append(mqtt.subscribe(this.mqtt_command_topic, (topic, payload) => {
            this.handle_service(payload);
        }))

        // Post availability
        await this.markAvailable();

        // Observe getState() and getAttributes(), pushing any changes to HA (use one topic so we can have atomic updates)
        this._disposers.append(plgmobx.reaction(this.application, () => ({ state: this.getState(), attrs: this.getExtraAttributes() }), (v: RawStatePayload<T>) => {
            const payload = this._getStatePayload(v);
            this.mqttConn.publish(this.mqtt_state_topic, JSON.stringify(payload), {
                retain: true,
            });
        }, { fireImmediately: true }))
    }

    protected _getStatePayload(state: RawStatePayload<T>): any {
        return state;
    }

    protected get mqttConn() {
        return this._bound_store.mqttConnection();
    }
}

export type RawStatePayload<T> = {
    state: T;
    attrs: any;
}

export { TDAbstractEntity };
