
import { HassEntity } from "home-assistant-js-websocket";
import { action, computed, observable } from "mobx";
import { Constructor } from "type-fest";

import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { HomeAssistantPlugin } from ".";
import { current } from "../../hypervisor/current";
import { Annotable, client_call_safe, getOrCreateLocalData, makeApiExport, notePluginAnnotation, pluginGetterFactory } from "../base";
import { ButtonOptions, EntityOptions, InputButton, InputEntity, InputOptions, NumberInputOptions, TDAbstractEntity, TDDevice, TDEntity, resolveEntityId } from "./entity_api";
import { domain_entities } from "./entity_api/domains";
import { EntityClass, EntityClassConstructor, EntityClassOptions, EntityClassType } from "./entity_api/domains/base";
import { EntityStore } from "./entity_api/store";

export interface FullState<V> {
    state: V;
    [key: string]: any;
}

interface DecOrNew<D extends (...params: any) => any, N extends Constructor<any>> {
    new(...params: ConstructorParameters<N>): InstanceType<N>
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

class StateOnlyEntity<T> extends TDAbstractEntity<T> {
    constructor(readonly options: EntityOptions, getter: () => T) {
        super(options.id, options);
        this.getState = getter;
    }

    readonly getState: () => T;
}

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, homeAssistantApi.defaultPluginId);
    const _entity_store = () => getOrCreateLocalData(_plugin(), current.application, "entities", (plg, app) => new EntityStore(plg, app));

    async function registerEntity(entity: TDEntity<any>) {
        _entity_store().registerEntity(entity);
    }

    function _stateOnlyDecorator<O extends {}, V>(domain: string, options: EntityOptions & O, metaOpts: { service?: string, value_key?: string } = {}) {
        return ((access, context: DecoratorContext) => {
            const entity_id = resolveEntityId(domain, options, context);

            let getter: (self: any) => any = null;

            const ents = new WeakMap<any, StateOnlyEntity<any>>();
            const gent = (self) => ents.get(self);
            const init = async (self) => {
                if (gent(self)) return;

                const ent = new StateOnlyEntity({ ...options, id: entity_id }, () => getter(self));
                ents.set(self, ent);
                await registerEntity(ent);
                // TODO Store a list of decorator-created entities. Destroy any that are no longer present
                //   Entries will need to track plugin type, plugin id, and any plugin/entry specific info
            }

            if (context.kind == 'getter') {
                const comptd = (computed as any)(access, context);

                getter = self => self[context.name];
                notePluginAnnotation(context, init);

                return comptd;
            }

            if (context.kind == 'accessor') {
                const obsvd = (observable as any)(access, context);

                getter = self => (obsvd.get as Function).call(self);
                notePluginAnnotation(context, init);

                return obsvd;
            }
        }) as ClassAccessorDecorator<Annotable, any> & ClassGetterDecorator<Annotable, any>
    }

    function stateOnlyDecorator<O extends {}, V>(domain: string) {
        return (options: EntityOptions) => _stateOnlyDecorator(domain, options);
    }

    function _linkFieldEntity<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        options: EntityClassOptions<E> & { id?: string },
        context: DecoratorContext,
        init_callback: (self, ent: E) => void,
    ) {
        const ents = new WeakMap<any, StateOnlyEntity<any>>();
        const gent = (self) => ents.get(self);

        const init = async (self) => {
            if (gent(self)) return;

            const { id, ...rest } = options;
            const ent = new ecls(id, rest as any);
            init_callback(self, ent);
            ents.set(self, ent);

            await registerEntity(ent);
            // TODO Store a list of decorator-created entities. Destroy any that are no longer present
            //   Entries will need to track plugin type, plugin id, and any plugin/entry specific info
        }

        notePluginAnnotation(context, init);
    }

    function _stateOnlyDecorator2<E extends EntityClass<any, any>>(ecls: EntityClassConstructor<E>, options: EntityClassOptions<E> & { id?: string }) {
        return ((access, context: DecoratorContext) => {
            if (context.kind == 'getter') {
                const comptd = (computed as any)(access, context);

                _linkFieldEntity(ecls, options, context, (self, ent) => {
                    ent.getState = () => self[context.name];
                })

                return comptd;
            }

            if (context.kind == 'accessor') {
                const obsvd = (observable as any)(access, context);

                _linkFieldEntity(ecls, options, context, (self, ent) => {
                    ent.getState = () => (obsvd.get as Function).call(self);
                })

                return obsvd;
            }
        }) as ClassAccessorDecorator<Annotable, any> & ClassGetterDecorator<Annotable, any>
    }

    // TODO These should support additional syntaxes:
    //   @sensor({...})
    //     - Will automatically destroy if removed/uuid changed
    //   sensor({ ... })(() => value)
    //     - Will automatically destroy if in initializer
    //   new sensor({ ... })
    function stateOnlyApi<E extends EntityClass<any, any>>(entCls: EntityClassConstructor<E>) {
        return (options: EntityClassOptions<E> & { id?: string }) => _stateOnlyDecorator2(entCls, options);
    }

    type RWInitCallback<E extends EntityClass<any, any, any>> = (self, entity: E, set: (v: EntityClassType<E>) => void) => void

    function _basicRWDecorator<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        options: EntityClassOptions<E> & { id?: string },
        init_callback: RWInitCallback<E>,
    ) {
        return ((access, context: DecoratorContext) => {
            const obsvd = (observable as any)(access, context);

            _linkFieldEntity(ecls, options, context, (self, ent) => {
                ent.getState = () => (obsvd.get as Function).call(self);
                const updateVal = (v) => (obsvd.set as Function).call(self, v);
                init_callback(self, ent, updateVal);
            })

            return obsvd;
        }) as ClassAccessorDecorator<Annotable, any>
    }

    function basicRWApi<E extends EntityClass<any, any>>(entCls: EntityClassConstructor<E>, autoinit_callback: RWInitCallback<E>) {
        return (options: EntityClassOptions<E> & { id?: string }) => _basicRWDecorator(entCls, options, autoinit_callback);
    }

    // TODO Allow imperitive/non-decorator calls to create these entities.
    const entities = {
        ...domain_entities,

        /** Create a `sensor` entity and update it whenever the decorated getter/accessor is updated */
        sensor: stateOnlyApi(domain_entities.sensor),
        // sensor: stateOnlyDecorator<{}, number>("sensor"),

        /** Create a `binary_sensor` entity and update it whenever the decorated getter/accessor is updated */
        binary_sensor: stateOnlyDecorator<{}, boolean>("binary_sensor"),

        // /** Create a `text_sensor` entity and update it whenever the decorated getter/accessor is updated */
        // text_sensor: stateOnlyDecorator<{}, string>("text_sensor"),

        /** Create a `weather` entity and update it whenever the decorated getter/accessor is updated */
        weather: stateOnlyDecorator<{}, {}>("weather"),

        /** Create a `device_tracker` entity and update it whenever the decorated getter/accessor is updated */
        device_tracker: stateOnlyDecorator<{}, string>("device_tracker"),

        /** Create a `person` entity and update it whenever the decorated getter/accessor is updated */
        person: stateOnlyDecorator<{}, string>("person"),

        // TODO number, select, text, switch, climate, light, cover
        //  Basically the same as the inputs, but state is kept in TD instead of HA
        //  Can be used as an accessor decorator, or as a constructor to register an X with custom service callbacks and state management

        switch: basicRWApi(domain_entities.switch, (app, entity, set) => {
            entity.on("turn_on", () => set(true));
            entity.on("turn_off", () => set(false));
        }),
    }

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions<any> & O, metaOpts: { service?: string, value_key?: string } = {}) {
        return ((access, context) => {
            const entity_id = resolveEntityId(domain, options, context);

            const ents = new WeakMap<any, InputEntity<any>>();
            const gent = (self) => ents.get(self);
            const init = async (self) => {
                if (gent(self)) return;

                const ent = new InputEntity({ ...options, id: entity_id });
                ents.set(self, ent);
                await registerEntity(ent);
            }

            notePluginAnnotation(context, init);

            return {
                get() {
                    init(this);
                    return gent(this).state;
                },
                set(value) {
                    init(this);
                    gent(this).state = value;
                },
            } as any
        }) as ClassAccessorDecorator<Annotable, any>
    }

    function inputApi<V, O extends {} = {}>(domain: string) {
        return optional_config_decorator([], (options?: InputOptions<V> & O): ClassAccessorDecorator<Annotable, V> => {
            return _inputDecorator(domain, options);
        });
    }

    type Iso8601String = string;

    /** Create an `input_button` helper and trigger the decorated method when pressed */
    const button = optional_config_decorator([null], (options?: ButtonOptions): ClassMethodDecorator => {
        return (func, context) => {
            const entity_id = resolveEntityId("input_button", options, context);

            notePluginAnnotation(context, async (self) => {
                const ent = new InputButton({ ...options, id: entity_id });
                await registerEntity(ent);

                // Listen to button press
                ent.on_pressed = () => client_call_safe(() => self[context.name]());
            })

            // @action()
            return action(func, context);
        }
    })

    const input = {
        /** Create an `input_number` helper and sync it with the decorated accessor */
        number: (options: NumberInputOptions) => _inputDecorator("input_number", options),

        /** Create an `input_text` helper and sync it with the decorated accessor */
        text: inputApi<string, { min?: number, max?: number, pattern?: string | RegExp, mode?: 'text' | 'password' }>("input_text"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        boolean: inputApi<boolean>("input_boolean"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        bool: inputApi<boolean>("input_boolean"),

        /** Create an `input_datetime` helper and sync it with the decorated accessor */
        datetime: inputApi<Date | number | Iso8601String, { has_date?: boolean, has_time?: boolean }>("input_datetime"),

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

        button,
    }

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

    const _mqttApi = () => _plugin().mqttApi();

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        /** Returns the underlying Connection object from `home-assistant-js-websocket`. This is advanced usage and should only be used if you know what you're doing */
        _getConnection: () => _plugin()._ha_api,
        /** Returns the underlying Connection object from `home-assistant-js-websocket`. This is advanced usage and should only be used if you know what you're doing */
        get _connection() { return _plugin()._ha_api },

        get states() { return _plugin().state },

        mqtt: {
            get api() { return _mqttApi() },
            get typedaemon_topic() {
                return _mqttApi().system_topic;
            },
            get application_topic() {
                return _mqttApi().application_topic;
            },
        },

        get application_device(): Readonly<TDDevice> {
            const app = current.application;
            return {
                name: app.options?.human_name || `TypeDaemon - ${app.id}`,
                manufacturer: "TypeDaemon",
                connections: [
                    ["td_app", app.uuid],
                ],
                identifiers: [
                    `td-${app.uuid}`,
                ],
            }
        },

        entity: entities,
        registerEntity,
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
