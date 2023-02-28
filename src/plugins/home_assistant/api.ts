
import { action, computed, observable, reaction } from "mobx";
import { HassEntity } from "home-assistant-js-websocket";

import { optional_config_decorator } from "@matchlighter/common_library/cjs/decorators/utils";

import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "../../common/decorator_fills";
import { HomeAssistantPlugin } from ".";
import { Annotable, notePluginAnnotation, pluginGetterFactory } from "../base";

export interface EntityOptions {
    id?: string;
    uuid?: string;
    friendly_name?: string;

    [key: string]: any;
}

export interface FullState<V> {
    state: V;
    [key: string]: any;
}

export interface InputOptions extends EntityOptions {
    id?: string;

    /** Whether the state of the property should update immediately, or if it should wait for HA to confirm the updated value */
    optimistic?: boolean;
    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;
}

export interface ButtonOptions extends EntityOptions {

}

function resolveEntityId(domain: string, options: { id?: string }, decContext?: DecoratorContext) {
    let entity_id: string = options.id || decContext?.name as string;
    if (!entity_id.includes('.')) entity_id = domain + '.' + entity_id;
    return entity_id;
}

const DEFAULT_ID = "home_assistant";

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, DEFAULT_ID);

    function stateOnlyDecorator<O extends {}, V>(domain: string) {
        return optional_config_decorator([], (options?: EntityOptions & O): ClassGetterDecorator<any, V | FullState<V>> => {
            return (get, context) => {
                const entity_id = resolveEntityId(domain, options, context);
                const { uuid, ...entOpts } = options;

                const comptd = (computed as any)(get, context);

                notePluginAnnotation(context, (self) => {
                    reaction(() => comptd.call(self), v => {
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
                    })
                })

                return comptd;
            }
        });
    }

    const entities = {
        sensor: stateOnlyDecorator<{}, number>("sensor"),
        binary_sensor: stateOnlyDecorator<{}, boolean>("binary_sensor"),
        text_sensor: stateOnlyDecorator<{}, string>("text_sensor"),
        weather: stateOnlyDecorator<{}, {}>("weather"),
        device_tracker: stateOnlyDecorator<{}, string>("device_tracker"),
        person: stateOnlyDecorator<{}, string>("person"),
    }

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions & O) {
        return ((access, context) => {
            const entity_id = resolveEntityId(domain, options, context);

            const obsvd = observable(access, context);

            notePluginAnnotation(context, async (self) => {
                // {"id":57,"type":"result","success":true,"result":{"area_id":null,"config_entry_id":null,"device_id":null,"disabled_by":null,"entity_category":null,"entity_id":"input_text.test2","has_entity_name":false,"hidden_by":null,"icon":null,"id":"8bef30db208442ea9ae0c5c3041a7bd7","name":null,"original_name":"test2","platform":"input_text","translation_key":null,"unique_id":"test2","aliases":[],"capabilities":null,"device_class":null,"options":{},"original_device_class":null,"original_icon":null}}
                const existing = await _plugin().request("config/entity_registry/get", { entity_id });

                if (existing /* TODO */) {
                    // TODO Update
                    // Update: {"type":"input_text/update","input_text_id":"test2","name":"test2","mode":"text","max":100,"min":0,"id":59}
                } else {
                    // TODO Create
                    // Create: {"type":"input_text/create","name":"test3","icon":"mdi:account","min":"5","max":"102","pattern":"\\d+","id":38}
                }

                // Read from HA
                obsvd.set.call(self, _plugin().state[entity_id])

                // TODO Listen to HA
            })

            return {
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
        return optional_config_decorator([], (options?: InputOptions & O): ClassAccessorDecorator<Annotable, V | FullState<V>> => {
            return _inputDecorator(domain, options);
        });
    }

    type Iso8601String = string;

    // Delete: {"type":"input_text/delete","input_text_id":"test3","id":55}
    // Show:
    //  {"type":"config/entity_registry/get","entity_id":"input_text.test2","id":57}
    //  {"id":57,"type":"result","success":true,"result":{"area_id":null,"config_entry_id":null,"device_id":null,"disabled_by":null,"entity_category":null,"entity_id":"input_text.test2","has_entity_name":false,"hidden_by":null,"icon":null,"id":"8bef30db208442ea9ae0c5c3041a7bd7","name":null,"original_name":"test2","platform":"input_text","translation_key":null,"unique_id":"test2","aliases":[],"capabilities":null,"device_class":null,"options":{},"original_device_class":null,"original_icon":null}}
    //  {"type":"input_text/list","id":58}
    //  {"id":58,"type":"result","success":true,"result":[{"name":"test","mode":"text","max":100,"min":0,"id":"test"},{"name":"test2","mode":"text","max":100,"min":0,"id":"test2"}]}

    const input = {
        number: inputDecorator<number>("input_number"),
        text: inputDecorator<string>("input_text"),
        boolean: inputDecorator<boolean>("input_boolean"),
        bool: inputDecorator<boolean>("input_boolean"),
        datetime: inputDecorator<Date | number | Iso8601String>("input_datetime"),
        select: <const T extends string>(options: T[], config?: InputOptions) => {
            return _inputDecorator("input_select", {
                options: options.join(','),
                ...config,
            })
        },
    }

    const button = optional_config_decorator([null], (options?: ButtonOptions): ClassMethodDecorator => {
        return (func, context) => {
            notePluginAnnotation(context, async (self) => {
                // TODO Register HA entity
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
        _plugin,
        entity: entities,
        input,
        button,

        callService,
        findRelatedEntities,
        // findRelatedDevices,
        toggleSwitch,
    }
}

export type HomeAssistantApi = ReturnType<typeof homeAssistantApi>;

export const api = {
    ...homeAssistantApi({ pluginId: DEFAULT_ID }),
    createInstance(...params: Parameters<typeof homeAssistantApi>) {
        return homeAssistantApi(...params);
    },
}
