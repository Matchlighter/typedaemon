
import { action, observable } from "mobx";
import { TDAbstractEntity, TDAbstractEntityOptions } from "../general";

export const KEEP_ATTRS = Symbol("Keep Attrs")

export class EntityClass<T, S extends Record<string, any[]>, O = {}> extends TDAbstractEntity<T> {
    constructor(id: string, options?: TDAbstractEntityOptions & O) {
        super(id, options);
    }

    declare readonly options: Readonly<TDAbstractEntityOptions & O>;

    @observable accessor state: T;
    @observable.struct accessor state_attrs: any = {};

    getState(): T { return this.state }
    getExtraAttributes() {
        return this.state_attrs;
    }

    // on<K extends keyof S>(event: K, handler: (...params: S[K]) => void) {

    // }

    handle_command(payload: any) {
        // TODO
        console.log(payload)
    }

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, discoveryPassOptions(this.options as EntityOptionsCommon & EntityOptionsCommonW, [
            "enabled_by_default",
            "encoding",
            "entity_category",
            "icon",
            // "json_attributes_template",
            // "json_attributes_topic",
            "qos",
            "optimistic",
            "retain",
        ]))
        return dd;
    }

    @action
    setState(state: T, state_attrs?: any) {
        this.state = state;
        if (state_attrs != KEEP_ATTRS) {
            this.state_attrs = state_attrs || {};
        }
    }
}

export type EntityClassConstructor<E extends EntityClass<any, any, any>> = {
    new(id: string, options?: EntityClassOptions<E>): E
}

export type EntityClassType<T extends EntityClass<any, any>> = T extends EntityClass<infer S, any, any> ? S : never;
export type EntityClassOptions<T extends EntityClass<any, any>> = T extends EntityClass<any, any, infer O> ? O & TDAbstractEntityOptions : never;

export function discoveryPassOptions<O extends {}>(options: O, keys: (keyof O)[]) {
    const pass: any = {}
    for (let k of keys) { pass[k] = options[k] }
    return pass;
}

export function typedEntityClass<T, const S extends Record<string, any[]>>(domain: string): typeof EntityClass<T, S> {
    class SimpleEntity extends EntityClass<T, S> {
        static domain = domain;
    }
    return SimpleEntity
}

type HAIcon = string;
export type HATemplate = `{{${string}}}`;

export interface EntityOptionsCommon {
    /** Flag which defines if the entity should be enabled when first added. */
    enabled_by_default?: boolean;

    /** The encoding of the payloads received and published messages. Set to "" to disable decoding of incoming payload. */
    encoding?: string;

    /** The category of the entity. */
    entity_category?: string;

    /** Icon for the entity. */
    icon?: HAIcon;

    // /** Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic. Usage example can be found in MQTT sensor documentation. */
    // json_attributes_template?: HATemplate;

    // /** The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes. Usage example can be found in MQTT sensor documentation. */
    // json_attributes_topic?: string;

    /** The maximum QoS level of the state topic. */
    qos?: 0 | 1 | 2;

    // /** Used instead of name for automatic generation of entity_id */
    // object_id?: string;
}

export interface EntityOptionsCommonW {
    /**
     * Flag that defines if the light works in optimistic mode.
     * Default: true if no state topic defined, else false.
     */
    optimistic?: boolean;

    /** If the published message should have the retain flag on or not. */
    retain?: boolean;
}
