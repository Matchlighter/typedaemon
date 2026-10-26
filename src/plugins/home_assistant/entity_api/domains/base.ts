
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

    /**
     * Dispatch a command from HA: call `handler` when the app set one, otherwise apply `optimistic` (if given) so HA
     * reflects the change without the app's involvement.
     */
    protected dispatch<A extends any[]>(handler: ((...args: A) => void) | undefined, args: A, optimistic?: () => void) {
        if (handler) return handler.apply(this, args);
        optimistic?.();
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

/** Copy the given (defined) options into discovery data verbatim */
export function discoveryPassOptions<O extends {}>(options: O | undefined, keys: (keyof O)[]) {
    const pass: any = {}
    for (let k of keys) {
        if (options?.[k] !== undefined) pass[k] = options[k];
    }
    return pass;
}

/**
 * `on_<service>` handler properties for a domain's Services map. Merge into the entity class so handler names always
 * match the services: `export interface TDFan extends CommandHandlers<FanServices> { }`
 */
export type CommandHandlers<S extends Record<string, any[]>> = {
    [K in keyof S & string as `on_${K}`]?: (...args: S[K]) => void;
}

/** Base for entities whose boolean state is published as HA's default `ON`/`OFF` payloads */
export class BooleanEntityClass<S extends Record<string, any[]>, O = {}> extends EntityClass<boolean, S, O> {
    protected _serializeState(state: boolean) {
        if (state === true) return "ON";
        if (state === false) return "OFF";
        return state;
    }
}

/** Parse an `ON`/`OFF` (or custom) command payload; `undefined` for anything else */
export function parseOnOff(payload: unknown, on = "ON", off = "OFF"): boolean | undefined {
    if (payload == on) return true;
    if (payload == off) return false;
    return undefined;
}

/** Parse a numeric command payload; `undefined` if it isn't a number or falls outside the (optional) inclusive bounds */
export function parseNumberPayload(payload: unknown, min?: number, max?: number): number | undefined {
    const n = typeof payload == "number" ? payload : parseFloat(String(payload));
    if (isNaN(n)) return undefined;
    if ((min != null && n < min) || (max != null && n > max)) return undefined;
    return n;
}

/**
 * Normalise a command payload that may be a JSON object or a plain string. Returns the object, or the payload as a string.
 * Payloads that look like a JSON object but fail to parse return `undefined`: callers must ignore the command rather
 * than misinterpret it. (Subscriptions normally JSON-decode payloads already; this also covers raw strings.)
 */
export function parseJsonOrRaw(payload: unknown): Record<string, any> | string | undefined {
    if (payload == null) return undefined;
    if (typeof payload == "object" && !(payload instanceof Uint8Array)) return payload as Record<string, any>;
    const str = String(payload);
    if (!str.trim().startsWith("{")) return str;
    try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed == "object" ? parsed : undefined;
    } catch {
        return undefined;
    }
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
