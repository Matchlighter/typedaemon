
import { action } from "mobx";
import { ha } from "../..";
import { plgmobx } from "../../mobx";
import { setAutocleaner } from "./auto_cleaning";
import { TDDevice, TDEntity } from "./base";
import { HA_DISCOVERY_PREFIX } from "../../mqtt/constants";
import { EntityStore } from "./store";

// Will need to give some thought to unique_ids.
//   Likely use `<application unique_id (configurable) || application id>_<unique_id (configurable) || lowercase(undercore(name))>`
//   Will want an escape hatch where no interpolation is performed (when user prefixes it with a `/` or some other character?)
const resolveUUID = (uuid: string, ent: TDAbstractEntity<any>) => {
    if (uuid && uuid.startsWith('/')) return uuid.substring(1);
    if (uuid && uuid.startsWith('uuid:')) return uuid.substring(5);
    return `td-${ent['application'].uuid}-${ent.entity_kind}-${uuid}`
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
            key: `td_abstract_entity-${(this as any).entity_kind || (this as any).domain}`,
            make_entry: (entity) => {
                // command_keys may depend on options (unavailable at cleanup time), so persist them
                return { id: entity['_uuid'], domain: entity.domain, command_keys: entity.command_keys() }
            },
            destroy_entity: async (state, store: EntityStore) => {
                // @ts-ignore
                const tempEntity = new this(state.id, { domain: state.domain });
                tempEntity._bound_store = store;
                if (state.command_keys) tempEntity.command_keys = () => state.command_keys;
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

    /**
     * Extra top-level fields to publish in the JSON state payload, for domains whose HA config reads several values
     * (e.g. cover position, climate target temperature). Point the HA option at the shared state topic with a template:
     * `{ position_topic: this.mqtt_state_topic, position_template: "{{ value_json.position }}" }`.
     * Keeps a single retained topic so updates stay atomic. `state` and `attrs` are reserved (throws if returned).
     * See `stateField()` for building the matching discovery options.
     */
    protected getStateFields(): Record<string, any> {
        return {}
    }

    readonly name: string;
    protected readonly device: Readonly<TDDevice>;

    get domain() {
        return this.options?.domain || (this.constructor as any).domain;
    }

    /**
     * Identifies the entity implementation when several classes back the same HA domain (e.g. MQTT `camera` vs the
     * companion-integration stream camera). Namespaces the uuid and autoclean entries so they can't collide.
     * Set `static entity_kind` to override; defaults to `domain`.
     */
    get entity_kind(): string {
        return (this.constructor as any).entity_kind || this.domain;
    }

    /** Name shown in HA; falls back to the entity's id */
    protected get display_name() {
        return this.name || this._uuid; // TODO humanize(_uuid)?
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
            `${HA_DISCOVERY_PREFIX}/${this.domain}/${this.uuid}/config`,
            `${this.mqtt_topic}/status`,
            this.mqtt_state_topic,
            // With the `retain` option HA publishes commands retained. Clear them so a stale command (e.g. `OPEN`) isn't
            // replayed to a future entity re-registered under the same uuid.
            ...this.command_keys().map(k => this.command_topic_for(k)),
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

    /**
     * Handle a payload received on one of the entity's command topics.
     * @param key Which command topic it arrived on (see `command_keys()`); `"command"` for the primary `command_topic`.
     */
    handle_command(payload: any, key?: string) {
        // TODO Map services
        // TODO
    }

    /**
     * Names of the MQTT command topics this entity listens on. Each key `k` is advertised in discovery as `<k>_topic`
     * (matching HA's naming, e.g. `set_position` -> `set_position_topic`, `preset_mode_command` -> `preset_mode_command_topic`)
     * and received payloads are routed to `handle_command(payload, k)`.
     * `"command"` is the primary `command_topic` (kept at `<entity>/cmd` for back-compat). Override and extend `super.command_keys()`.
     */
    protected command_keys(): string[] {
        return ["command"];
    }

    /** MQTT topic for the given command key */
    protected command_topic_for(key: string) {
        if (key == "command") return this.mqtt_command_topic;
        return `${this.mqtt_command_topic}/${key}`;
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

    /**
     * Discovery options pointing an HA `<topic>`/`<template>` option pair at a top-level field of the JSON state payload
     * (see `getStateFields()`). HA's option names vary per domain/field (`*_state_topic` + `*_state_template`,
     * `*_topic` + `*_template`, `*_state_topic` + `*_value_template`), so both are given explicitly.
     * @param template_value Template to use instead of `{{ value_json.<field> }}`
     */
    protected stateField(topic: string, template: string, field: string, template_value = `{{ value_json.${field} }}`): DiscoveryData {
        return { [topic]: this.mqtt_state_topic, [template]: template_value };
    }

    protected discovery_data(): DiscoveryData {
        const dd = {
            availability: [
                { topic: `${this._bound_store.mqtt_system_topic}/status` }, // TD
                { topic: `${this._bound_store.mqtt_application_topic}/status` }, // App
                { topic: `${this.mqtt_topic}/status` }, // Entity
            ],

            availability_mode: "all",

            name: this.display_name,
            unique_id: this.uuid,
            object_id: this.options?.object_id,

            state_topic: this.mqtt_state_topic,
            json_attributes_topic: this.mqtt_state_topic,
            value_template: "{{ value_json.state }}",
            json_attributes_template: "{{ value_json.attrs }}",

            command_topic: this.mqtt_command_topic,

            device: this.device,
        }
        for (const key of this.command_keys()) {
            dd[`${key}_topic`] = this.command_topic_for(key);
        }
        return dd;
    }

    async reconfigure() {
        const mqtt = this._bound_store.mqttApi();
        const dd = this.discovery_data();
        mqtt.publish(`${HA_DISCOVERY_PREFIX}/${this.domain}/${this.uuid}/config`, JSON.stringify(dd), {
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
        for (const key of this.command_keys()) {
            this._disposers.append(mqtt.subscribe(this.command_topic_for(key), action((topic, payload) => {
                this.handle_command(payload, key);
            })))
        }

        // Post availability
        await this.markAvailable();

        // Observe getState() and getAttributes(), pushing any changes to HA (use one topic so we can have atomic updates)
        this._disposers.append(plgmobx.reaction(this.application, () => this._statePayload(), (v: RawStatePayload<T>) => {
            v.state = this._serializeState(v.state);
            this._publishState(v);
        }, { fireImmediately: true }))
    }

    protected _statePayload(): RawStatePayload<T> {
        const fields = this.getStateFields();
        for (const k of RESERVED_STATE_FIELDS) {
            if (k in fields) throw new Error(`${this.constructor.name}.getStateFields() returned reserved key "${k}"`);
        }
        return { ...fields, state: this.getState(), attrs: this.getExtraAttributes() };
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

const RESERVED_STATE_FIELDS = ["state", "attrs"] as const;

/** MQTT discovery config payload */
export type DiscoveryData = Record<string, any>;

/** Base discovery options a domain may need to drop (see `omitDiscoveryKeys`) */
type BaseDiscoveryKey = "state_topic" | "value_template" | "command_topic";

/** Remove base discovery options a domain's HA schema doesn't have (e.g. no primary state or command topic) */
export function omitDiscoveryKeys(dd: DiscoveryData, ...keys: BaseDiscoveryKey[]) {
    for (const k of keys) delete dd[k];
}

/** For domains (fan, humidifier, siren) whose HA schema reads the main state via `state_value_template` instead of `value_template` */
export function useStateValueTemplate(dd: DiscoveryData) {
    dd.state_value_template = dd.value_template;
    delete dd.value_template;
}

export type RawStatePayload<T> = {
    state: T;
    attrs: any;
    [k: string]: any;
}

export { TDAbstractEntity };
