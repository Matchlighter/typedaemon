import { observable } from "mobx";

import { ha } from "../..";
import { plgmobx } from "../../mobx";
import { TDDevice, TDEntity } from "./base";
import { logMessage } from "../../../hypervisor/logging";

// Will need to give some thought to unique_ids.
//   Likely use `<application unique_id (configurable) || application id>_<unique_id (configurable) || lowercase(undercore(name))>`
//   Will want an escape hatch where no interpolation is performed (when user prefixes it with a `/` or some other character?)
const resolveUUID = (uuid: string, ent: TDEntity<any>) => {
    const ent_bits = ent.id.split('.');
    const ent_did = ent_bits[ent_bits.length - 1]
    uuid ||= ent_did;

    if (uuid.startsWith('/')) return uuid.substring(1);

    return `td-${ent['application'].uuid}-${uuid}`
}

abstract class TDAbstractEntity<T> extends TDEntity<T> {
    constructor(uuid: string, options?: { device?: TDDevice, name?: string }) {
        super();

        this.name = options.name;

        // Device to default to an application-linked device
        this.device = options?.device || ha.application_device;

        this._uuid = uuid;
    }

    private _uuid: string;
    private _abs_uuid: string;
    get uuid() {
        this._abs_uuid ||= resolveUUID(this._uuid, this);
        return this._abs_uuid;
    }

    /** Compute and return the current state object (attributes included) */
    abstract getState(): T;

    readonly name: string;
    protected readonly device: Readonly<TDDevice>;

    get domain() {
        return this.id.split('.')[0];
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

    async handle_service(payload: any) {
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

            state_topic: this.mqtt_state_topic,
            command_topic: this.mqtt_command_topic,

            device: this.device,
        }
    }

    // Make the entity discoverable. Use MQTT for MVP, possibly develop integration later
    protected async _register_in_ha() {
        const mqtt = await this._bound_store.mqttApi();
        if (!mqtt) throw new Error("HA Plugin not associated with an MQTT Plugin");

        // Dispatch MQTT Discovery message
        const dd = this.discovery_data();
        mqtt.publish(`homeassistant/${this.domain}/${this.uuid}/config`, JSON.stringify(dd), {
            retain: true,
        });

        // Listen for Commands
        this._disposers.append(mqtt.subscribe(this.mqtt_command_topic, (topic, payload) => {
            this.handle_service(payload);
        }))

        // Post availability
        await this.markAvailable();

        // Observe getState(), pushing any changes to HA
        this._disposers.append(plgmobx.reaction(this.application, () => this.getState(), (v) => {
            this.mqttConn.publish(dd.state_topic, JSON.stringify(v), {
                retain: true,
            });
        }, { fireImmediately: true }))
    }

    protected get mqttConn() {
        return this._bound_store.mqttConnection();
    }
}

type AnyFunc = (...params: any[]) => any;

type SimpleThis<C extends TDAbstractEntity<any>, T> = C & { state: T }

type SimpleMethods<C extends TDAbstractEntity<any>, T> = {
    [K in keyof C]?: C[K] extends AnyFunc ? ((this: SimpleThis<C, T>, ...params: Parameters<C[K]>) => ReturnType<C[K]>) : never;
}

class ISimpleEntity<T> extends TDAbstractEntity<T> {
    id: string;

    state: T;

    getState(): T { return null }
}

function makeSimpleClass<T, C extends typeof TDAbstractEntity<T>>(cls: C, methods: SimpleMethods<InstanceType<C>, T>): typeof ISimpleEntity<T> {
    class SimpleEntity extends (cls as typeof TDAbstractEntity<T>) {
        id: string;

        @observable state: T;

        getState() {
            return this.state;
        }
    }

    Object.assign(SimpleEntity.prototype, methods);

    return SimpleEntity as any;
}

export abstract class TDSensor extends TDAbstractEntity<number> {
    static domain = 'sensor';
}
export abstract class TDTextSensor extends TDAbstractEntity<string> {
    static domain = 'text_sensor';
}

export abstract class TDSwitch extends TDAbstractEntity<boolean> {
    static domain = 'switch';

    // static Simple = makeSimpleClass<boolean, typeof TDSwitch>(TDSwitch, {
    //     turn_on() { this.state = true; },
    //     turn_off() { this.state = false; },
    // });

    abstract turn_on();
    abstract turn_off();
}

export abstract class TDLight extends TDAbstractEntity<number> {
    static domain = 'light';

    abstract turn_on();
    abstract turn_off();
}

export { TDAbstractEntity };
