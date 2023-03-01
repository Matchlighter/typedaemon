
import { action, computed, observable } from "mobx";
import { HassEntity } from "home-assistant-js-websocket";

import { optional_config_decorator } from "@matchlighter/common_library/cjs/decorators/utils";

import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "../../common/decorator_fills";
import { HomeAssistantPlugin } from ".";
import { Annotable, client_call_safe, makeApiExport, notePluginAnnotation, pluginGetterFactory } from "../base";
import { current } from "../../hypervisor/current";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import { smobx } from "../mobx";

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

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, homeAssistantApi.defaultPluginId);

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
                        smobx.autorun(self[HyperWrapper], () => {
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
            if (currentState) {
                // Update: {"type":"input_text/update","input_text_id":"test2","name":"test2","mode":"text","max":100,"min":0,"id":59}
                await pl.request(`${domain}/update`, {
                    [`${domain}_id`]: entity_id.split('.')[1],
                    ...pass,
                })
            } else {
                // Create: {"type":"input_text/create","name":"test3","icon":"mdi:account","min":"5","max":"102","pattern":"\\d+","id":38}
                await pl.request(`${domain}/create`, {
                    ...pass,
                })
            }
        }
    }

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions<any> & O) {
        return ((access, context) => {
            const entity_id = resolveEntityId(domain, options, context);
            const obsvd = observable(access, context);

            notePluginAnnotation(context, async (self) => {
                await _ensureInput(entity_id, options);

                // Read and Listen from HA
                smobx.autorun(self[HyperWrapper], () => {
                    client_call_safe(() => {
                        obsvd.set.call(self, _plugin().state[entity_id]);
                    })
                });
            })

            return {
                // NB If we decide to remove optimistic, we could just forward gets to plugin.state[]
                ...obsvd,
                set(value) {
                    if (options.optimistic) {
                        obsvd.set.call(this, value);
                    }
                    // Set: {"type":"call_service","domain":"input_number","service":"set_value","service_data":{"value":50,"entity_id":"input_number.test"},"id":69}
                    _plugin().sendMessage("call_service", {
                        domain,
                        service: "set_value",
                        service_data: {
                            entity_id,
                            value,
                        }
                    })
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
                options: options.join(','),
                ...config,
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
                smobx.reaction(self[HyperWrapper], () => _plugin().state[entity_id], (state) => {
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
