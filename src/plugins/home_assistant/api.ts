
import { action, computed, observable, runInAction } from "mobx";
import { HassEntity } from "home-assistant-js-websocket";

import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";
import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "@matchlighter/common_library/decorator_fills";

import { HomeAssistantPlugin } from ".";
import { Annotable, client_call_safe, makeApiExport, notePluginAnnotation, pluginGetterFactory } from "../base";
import { current } from "../../hypervisor/current";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import { plgmobx } from "../mobx";
import { Constructor } from "type-fest";

export interface EntityOptions {
    id?: string;
    uuid?: string;
    name?: string;

    [key: string]: any;
}

export interface FullState<V> {
    state: V;
    [key: string]: any;
}

export interface InputOptions<T> extends EntityOptions {
    id?: string;

    initial?: T;

    icon?: string;

    /** Whether the state of the property should update immediately, or if it should wait for HA to confirm the updated value */
    optimistic?: boolean;
    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;
}

export interface ButtonOptions extends EntityOptions {
    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;
}

function resolveEntityId(domain: string, options: { id?: string }, decContext?: DecoratorContext) {
    let entity_id: string = options.id || decContext?.name as string;
    if (!entity_id.includes('.')) entity_id = domain + '.' + entity_id;
    return entity_id;
}

interface DecOrNew<D extends (...params: any) => any, N extends Constructor<any>> {
    new (...params: ConstructorParameters<N>): InstanceType<N>
    (...params: Parameters<D>): ReturnType<D>
}

function decOrNew<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N> {
    return function (...params) {
        if (new.target) {
            return new construct(...params);
        } else {
            return decMethod(...params);
        }
    } as any
}

class TDEntity<T> {
    @observable accessor state: T;
    @observable accessor attributes;
}

class Sensor extends TDEntity<number> {

}

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, homeAssistantApi.defaultPluginId);

    function registerEntity(entity: TDEntity<any>, device?) {
        // TODO Make the entity discoverable. Use MQTT for MVP, possibly develop integration later

        // Device to default to an application-linked device

        // Will need to give some thought to unique_ids. Likely use the `<application unique_id (configurable) || application id>_<unique_id (configurable) || lowercase(undercore(name))>`

        // TODO Offline the entity when the app goes down
    }

    function stateOnlyDecorator<O extends {}, V>(domain: string) {
        return optional_config_decorator([], (options?: EntityOptions & O): (ClassGetterDecorator<any, V | FullState<V>> | ClassAccessorDecorator<any, V | FullState<V>>) => {
            return (target, context: ClassAccessorDecoratorContext | ClassGetterDecoratorContext) => {
                const entity_id = resolveEntityId(domain, options, context);
                const { uuid, ...entOpts } = options;

                const writeState = (v) => {
                    let state: V = v;
                    let rest: any;
                    if (typeof v == 'object' && 'state' in v) {
                        const { state: nstate, ...therest } = v;
                        state = nstate;
                        rest = therest;
                    }
                    _plugin().writeSOState(entity_id, state, {
                        ...entOpts,
                        ...rest,
                    });
                }

                if (context.kind == 'getter') {
                    const comptd = (computed as any)(target, context);

                    notePluginAnnotation(context, (self) => {
                        plgmobx.autorun(self[HyperWrapper], () => {
                            client_call_safe(() => {
                                writeState(comptd.call(self));
                            })
                        })
                    })

                    return comptd;
                }

                if (context.kind == 'accessor') {
                    const obsvd = (observable as any)(target, context);
                    return {
                        ...obsvd,
                        set(value) {
                            writeState(value);
                            obsvd.set.call(this, value);
                        },
                    }
                }
            }
        });
    }

    // TODO Allow imperitive/non-decorator calls to create these entities.
    const entities = {
        /** Create a `sensor` entity and update it whenever the decorated getter/accessor is updated */
        sensor: stateOnlyDecorator<{}, number>("sensor"),

        /** Create a `binary_sensor` entity and update it whenever the decorated getter/accessor is updated */
        binary_sensor: stateOnlyDecorator<{}, boolean>("binary_sensor"),

        /** Create a `text_sensor` entity and update it whenever the decorated getter/accessor is updated */
        text_sensor: stateOnlyDecorator<{}, string>("text_sensor"),

        /** Create a `weather` entity and update it whenever the decorated getter/accessor is updated */
        weather: stateOnlyDecorator<{}, {}>("weather"),

        /** Create a `device_tracker` entity and update it whenever the decorated getter/accessor is updated */
        device_tracker: stateOnlyDecorator<{}, string>("device_tracker"),

        /** Create a `person` entity and update it whenever the decorated getter/accessor is updated */
        person: stateOnlyDecorator<{}, string>("person"),

        // TODO number, select, switch, climate, switch, light, cover
        //  Basically the same as the inputs, but state is kept in TD instead of HA
        //  Can be used as an accessor decorator, or as a function to register an X with custom service callbacks and state management
    }

    async function _ensureInput(entity_id: string, options: InputOptions<any> & { [k: string]: any }) {
        const pl = _plugin();
        const domain = entity_id.split('.')[0];
        const currentState = pl.state[entity_id];

        // {"id":57,"type":"result","success":true,"result":{"area_id":null,"config_entry_id":null,"device_id":null,"disabled_by":null,"entity_category":null,"entity_id":"input_text.test2","has_entity_name":false,"hidden_by":null,"icon":null,"id":"8bef30db208442ea9ae0c5c3041a7bd7","name":null,"original_name":"test2","platform":"input_text","translation_key":null,"unique_id":"test2","aliases":[],"capabilities":null,"device_class":null,"options":{},"original_device_class":null,"original_icon":null}}
        // const existing = await pl.request("config/entity_registry/get", { entity_id });

        const { existing: assertExisting, id: _id, uuid: _uuid, optimistic, ...pass } = options;

        for (let [k, v] of Object.entries(pass as any)) {
            if (v instanceof Date) pass[k as any] = v.toISOString();
            if (v instanceof RegExp) pass[k as any] = v.source;
        }

        if (options.existing) {
            if (!currentState) {
                current.application.logMessage("warn", `Expected entity ${entity_id} to exist in HA but it didn't`)
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

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions<any> & O, metaOpts: { service?: string, value_key?: string } = {}) {

        return ((access, context) => {
            const entity_id = resolveEntityId(domain, options, context);
            const obsvd = observable(access, context) as ClassAccessorDecoratorResult<any, any>;

            notePluginAnnotation(context, async (self) => {
                await _ensureInput(entity_id, options);

                const pl = _plugin();

                // Read and Listen from HA
                plgmobx.autorun(self[HyperWrapper], () => {
                    const value = pl.state[entity_id]?.state;
                    client_call_safe(() => {
                        runInAction(() => {
                            obsvd.set.call(self, value);
                        })
                    })
                });
            })

            return {
                // NB If we decide to remove optimistic, we could just forward gets to plugin.state[]
                ...obsvd,
                async set(value) {
                    if (options.optimistic) {
                        obsvd.set.call(this, value);
                    }
                    // Set: {"type":"call_service","domain":"input_number","service":"set_value","service_data":{"value":50,"entity_id":"input_number.test"},"id":69}
                    try {
                        const sparams: any = {
                            entity_id,
                        };
                        sparams[metaOpts.value_key || 'value'] = value;
                        await _plugin().callService(metaOpts.service || `${domain}.set_value`, sparams)
                    } catch (ex) {
                        console.error(ex);
                    }
                    // _plugin().sendMessage("call_service", {
                    //     domain,
                    //     service: "set_value",
                    //     service_data: {
                    //         entity_id,
                    //         value,
                    //     }
                    // })
                },
            } as any
        }) as ClassAccessorDecorator<Annotable, any>
    }

    function inputDecorator<V, O extends {} = {}>(domain: string) {
        return optional_config_decorator([], (options?: InputOptions<V> & O): ClassAccessorDecorator<Annotable, V | FullState<V>> => {
            return _inputDecorator(domain, options);
        });
    }

    type Iso8601String = string;

    const input = {
        /** Create an `input_number` helper and sync it with the decorated accessor */
        number: inputDecorator<number, { min?: number, max?: number, step?: number, mode?: 'slider' | 'box' }>("input_number"),

        /** Create an `input_text` helper and sync it with the decorated accessor */
        text: inputDecorator<string, { min?: number, max?: number, pattern?: string | RegExp, mode?: 'text' | 'password' }>("input_text"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        boolean: inputDecorator<boolean>("input_boolean"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        bool: inputDecorator<boolean>("input_boolean"),

        /** Create an `input_datetime` helper and sync it with the decorated accessor */
        datetime: inputDecorator<Date | number | Iso8601String, { has_date?: boolean, has_time?: boolean }>("input_datetime"),

        /** Create an `input_select` helper and sync it with the decorated accessor */
        select: <const T extends string>(options: T[], config?: InputOptions<T>) => {
            return _inputDecorator("input_select", {
                options: options,
                ...config,
            }, {
                service: "input_select.select_option",
                value_key: "option",
            })
        },
    }

    /** Create an `input_button` helper and trigger the decorated method when pressed */
    const button = optional_config_decorator([null], (options?: ButtonOptions): ClassMethodDecorator => {
        return (func, context) => {
            const entity_id = resolveEntityId("input_button", options, context);

            notePluginAnnotation(context, async (self) => {
                await _ensureInput(entity_id, options);

                // Listen to HA entity
                plgmobx.reaction(self[HyperWrapper], () => _plugin().state[entity_id], (state) => {
                    client_call_safe(() => self[context.name]());
                }, { fireImmediately: false })
            })

            // @action()
            return (action as any)(func, context);
        }
    })

    function callService(...params: Parameters<HomeAssistantPlugin['callService']>) {
        return _plugin().callService(...params);
    }

    async function toggleSwitch(ent: HassEntity) {
        let domain = 'homeassistant';
        const group = ent.entity_id.split('.')[0];

        if (['switch', 'light', 'fan'].indexOf(group) !== -1) {
            domain = group;
        }

        let service = 'toggle';

        if (ent.state === 'off') {
            service = 'turn_on';
        } else if (ent.state === 'on') {
            service = 'turn_off';
        }

        return await callService(`${domain}.${service}`, { entity_id: ent.entity_id })
    }

    // async function findRelatedDevices(entity: HassEntity) {
    //     // TODO
    // }

    async function findRelatedEntities(entity: HassEntity): Promise<string[]> {
        const pl = _plugin();
        const response1: any = await pl.request('search/related', { item_type: 'entity', item_id: entity.entity_id });
        const relatedDeviceIds = response1['device'];
        if (!relatedDeviceIds) return [];
        // const response2: any = await pl.request('search/related', { item_type: 'device', item_id: relatedDeviceIds[0] });
        // return response2['entity'] || [];
        return response1['entity'] || [];
    }

    function subscribe() {
        // TODO
        // TODO Add the subscription to a cleanup registry!
    }

    // TODO Unlink any events that we setup on HA when the app shuts down
    //   current.application.cleanups.append()

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        /** Returns the underlying Connection object from `home-assistant-js-websocket`. This is advanced usage and should only be used if you know what you're doing */
        _getConnection: () => _plugin()._ha_api,
        /** Returns the underlying Connection object from `home-assistant-js-websocket`. This is advanced usage and should only be used if you know what you're doing */
        get _connection() { return _plugin()._ha_api },

        get states() { return _plugin().state },

        entity: entities,
        input,
        button,
        callService,
        findRelatedEntities,
        // findRelatedDevices,
        toggleSwitch,
    }
}
homeAssistantApi.defaultPluginId = "home_assistant";

export type HomeAssistantApi = ReturnType<typeof homeAssistantApi>;

export const api = makeApiExport(homeAssistantApi)
