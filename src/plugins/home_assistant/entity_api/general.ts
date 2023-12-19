
import { ha } from "../..";
import { plgmobx } from "../../mobx";
import { setAutocleaner } from "./auto_cleaning";
import { TDDevice, TDEntity } from "./base";
import { EntityStore } from "./store";

// Will need to give some thought to unique_ids.
//   Likely use `<application unique_id (configurable) || application id>_<unique_id (configurable) || lowercase(undercore(name))>`
//   Will want an escape hatch where no interpolation is performed (when user prefixes it with a `/` or some other character?)
const resolveUUID = (uuid: string, ent: TDAbstractEntity<any>) => {
    if (uuid && uuid.startsWith('/')) return uuid.substring(1);
    if (uuid && uuid.startsWith('uuid:')) return uuid.substring(5);
    return `td-${ent['application'].uuid}-${ent.domain}-${uuid}`
}

export interface TDAbstractEntityOptions {
    device?: TDDevice,
    name?: string,

    /** Used instead of name for automatic generation of entity_id */
    object_id?: string;

    domain?: string;
}

abstract class TDAbstractEntity<T> extends TDEntity<T> {
    constructor(id: string, options?: TDAbstractEntityOptions) {
        super();

        this._uuid = id;

        this.options = options || {};

        this.name = options?.name;

        // Device to default to an application-linked device
        this.device = options?.device || ha.application_device;
    }

    protected readonly options?: Readonly<TDAbstractEntityOptions>;

    static _defaultAutocleaner() {
        setAutocleaner(this, {
            key: `td_abstract_entity-${(this as any).domain}`,
            make_entry: (entity) => {
                return { id: entity['_uuid'], domain: entity.domain }
            },
            destroy_entity: async (state, store: EntityStore) => {
                // @ts-ignore
                const tempEntity = new this(state.id, { domain: state.domain });
                tempEntity._bound_store = store;
                return await tempEntity._destroy();
            },
        })
    }

    static {
        this._defaultAutocleaner();
    }

    private readonly _uuid: string;
    private _abs_uuid: string;
    get uuid() {
        this._abs_uuid ||= resolveUUID(this._uuid, this);
        return this._abs_uuid;
    }

    /** Compute and return the current state value */
    protected abstract getState(): T;

    /** Compute and return any additional attributes */
    protected getExtraAttributes(): any {
        return {}
    }

    readonly name: string;
    protected readonly device: Readonly<TDDevice>;

    get domain() {
        return this.options?.domain || (this.constructor as any).domain;
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

    protected async handle_command(payload: any) {
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

            name: this.name || this._uuid, // TODO humanize(_uuid)?
            unique_id: this.uuid,
            object_id: this.options?.object_id,

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
            this.handle_command(payload);
        }))

        // Post availability
        await this.markAvailable();

        // Observe getState() and getAttributes(), pushing any changes to HA (use one topic so we can have atomic updates)
        this._disposers.append(plgmobx.reaction(this.application, () => ({ state: this.getState(), attrs: this.getExtraAttributes() }), (v: RawStatePayload<T>) => {
            v.state = this._serializeState(v.state);
            this._publishState(v);
        }, { fireImmediately: true }))
    }

    protected _serializeState(state: T): any {
        return state;
    }

    protected _publishState(v: RawStatePayload<T>) {
        this.mqttConn.publish(this.mqtt_state_topic, JSON.stringify(v), {
            retain: true,
        });
    }

    protected get mqttConn() {
        return this._bound_store.mqttConnection();
    }
}

export type RawStatePayload<T> = {
    state: T;
    attrs: any;
    [k: string]: any;
}

export { TDAbstractEntity };
