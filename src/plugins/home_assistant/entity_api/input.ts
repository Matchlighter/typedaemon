import { observable, runInAction } from "mobx";
import * as moment from "moment";

import type { HomeAssistantPlugin } from "..";
import { client_call_safe } from "../../base";
import { plgmobx } from "../../mobx";
import { setAutocleaner } from "./auto_cleaning";
import { EntityOptions, TDEntity } from "./base";
import { EntityStore } from "./store";

export interface InputOptions<T> extends EntityOptions {
    initial?: T;

    icon?: string;

    /** Whether the state of the property should update immediately, or if it should wait for HA to confirm the updated value */
    optimistic?: boolean;

    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;

    domain?: string;
}

export interface NumberInputOptions extends InputOptions<number> {
    min: number;
    max: number;
    step?: number;
    mode?: 'slider' | 'box';
}

export type HABoolean = "on" | "off";

class InputEntity<T> extends TDEntity<T> {
    constructor(readonly id: string, readonly options: InputOptions<T>) {
        super();
    }

    static _defaultAutocleaner() {
        setAutocleaner(this, {
            key: `td_input-${(this as any).domain}`,
            make_entry: (entity) => {
                return { id: entity['_uuid'], domain: entity.domain }
            },
            destroy_entity: async (state, store: EntityStore) => {
                const tempEntity = new this(state.id, { domain: state.domain });
                tempEntity._bound_store = store;
                return await tempEntity._destroy();
            },
        })
    }

    static { this._defaultAutocleaner(); }

    get uuid() {
        return `${this.domain}.${this.id}`
    }

    get domain() {
        return this.options?.domain || (this.constructor as any).domain;
    }

    @observable
    private accessor _state: T;

    // NB If we decide to remove optimistic, we could just forward gets to plugin.state[]

    get state() {
        return this._state;
    }

    set state(value) {
        if (this.options.optimistic) {
            this._state = value;
        }

        let service: string;
        const service_params: any = {
            entity_id: this.uuid,
        };

        if (this.domain == "input_datetime" && value instanceof Date) {
            value = value.toISOString() as any;
        }
        if (this.domain == "input_datetime" && moment.isMoment(value)) {
            value = value.toISOString() as any;
        }
        if (this.domain == "input_boolean" && typeof value == "boolean") {
            value = value ? "on" : "off" as any;
        }

        if (this.domain == "input_select") {
            service = "input_select.select_option";
            service_params["option"] = value;
        } else {
            service = `${this.domain}.set_value`;
            service_params["value"] = value;
        }

        // Set: {"type":"call_service","domain":"input_number","service":"set_value","service_data":{"value":50,"entity_id":"input_number.test"},"id":69}
        this.plugin.callService(service, service_params).catch(console.error)
    }

    protected get plugin() { return this._bound_store.plugin }

    protected _unlink() { }

    protected _destroy() {
        // TODO
        throw new Error("Method not implemented.");
    }

    protected async _register_in_ha() {
        const pl = this.plugin;

        await this.ensureExists(pl);

        // Read and Listen from HA
        this._disposers.append(
            plgmobx.autorun(this.application, () => {
                const value = pl.state[this.uuid]?.state;
                client_call_safe(() => {
                    runInAction(() => {
                        this._state = value as any;
                    })
                })
            })
        );
    }

    protected async ensureExists(pl: HomeAssistantPlugin) {
        const entity_id = this.uuid;
        const domain = this.domain;
        const currentState = pl.state[entity_id];

        // {"id":57,"type":"result","success":true,"result":{"area_id":null,"config_entry_id":null,"device_id":null,"disabled_by":null,"entity_category":null,"entity_id":"input_text.test2","has_entity_name":false,"hidden_by":null,"icon":null,"id":"8bef30db208442ea9ae0c5c3041a7bd7","name":null,"original_name":"test2","platform":"input_text","translation_key":null,"unique_id":"test2","aliases":[],"capabilities":null,"device_class":null,"options":{},"original_device_class":null,"original_icon":null}}
        // const existing = await pl.request("config/entity_registry/get", { entity_id });

        const { existing: assertExisting, id: _id, domain: _domain, optimistic, ...pass } = this.options;

        for (let [k, v] of Object.entries(pass as any)) {
            if (v instanceof Date) pass[k as any] = v.toISOString();
            if (v instanceof RegExp) pass[k as any] = v.source;
        }

        if (this.options.existing) {
            if (!currentState) {
                this.application.logMessage("warn", `Expected entity ${entity_id} to exist in HA but it didn't`)
            }
        } else {
            if (!currentState) {
                // HA Doesn't allow creation by both id and name, so we create it using the id as the name, then update it with the name

                // Create: {"type":"input_text/create","name":"test3","icon":"mdi:account","min":"5","max":"102","pattern":"\\d+","id":38}
                await pl.request(`${domain}/create`, {
                    ...pass,
                    name: entity_id.split('.')[1],
                })
            }

            // Update: {"type":"input_text/update","input_text_id":"test2","name":"test2","mode":"text","max":100,"min":0,"id":59}
            await pl.request(`${domain}/update`, {
                [`${domain}_id`]: entity_id.split('.')[1],
                ...pass,
            })
        }
    }
}

export interface ButtonOptions extends EntityOptions {
    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;
}

class InputButton extends InputEntity<never> {
    static domain = "input_button";

    static { this._defaultAutocleaner(); }

    constructor(id: string, options: ButtonOptions) {
        super(id, options);
    }

    on_pressed() { }

    protected async _register_in_ha() {
        const pl = this.plugin;

        await this.ensureExists(pl);

        // Listen to HA entity
        plgmobx.reaction(this.application, () => pl.state[this.uuid]?.state, (state) => {
            this.on_pressed();
        }, { fireImmediately: false })
    }
}

export interface SelectOptions<T extends string> extends EntityOptions {
    options: T[]
}

class InputSelect<const T extends string> extends InputEntity<T> {
    static domain = "input_select";

    static { this._defaultAutocleaner(); }

    constructor(id: string, options: SelectOptions<T>) {
        super(id, options);
    }
}

export { InputButton, InputEntity, InputSelect };

