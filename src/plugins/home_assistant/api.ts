
import { HassEntity, MessageBase } from "home-assistant-js-websocket";
import { action, computed, observable } from "mobx";
import { Constructor } from "type-fest";

import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { HomeAssistantPlugin } from ".";
import { current } from "../../hypervisor/current";
import { Annotable, client_call_safe, getOrCreateLocalData, makeApiExport, notePluginAnnotation, pluginGetterFactory } from "../base";
import { ButtonOptions, EntityOptions, InputButton, InputEntity, InputOptions, InputSelect, NumberInputOptions, TDAbstractEntity, TDDevice, TDEntity, resolveEntityId } from "./entity_api";
import { domain_entities } from "./entity_api/domains";
import { EntityClass, EntityClassConstructor, EntityClassOptions, EntityClassType } from "./entity_api/domains/base";
import { EntityStore } from "./entity_api/store";

export interface FullState<V> {
    state: V;
    [key: string]: any;
}

// type MCD = (target, context: DecoratorContext) => void;
// type MCC = Constructor<any>;
// type MCI = (...params: any[]) => any;

// function multicall<D extends (...params: any) => any, N extends Constructor<any>>({ decorator:  }): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N> {
//     return function (...params) {
//         if (new.target) {
//             return new construct(...params);
//         } else {
//             return decMethod(...params);
//         }
//     } as any
// }

interface FuncOrNew<F extends (...params: any) => any, N extends Constructor<any>> {
    new(...params: ConstructorParameters<N>): InstanceType<N>
    (...params: Parameters<F>): ReturnType<F>
}

function funcOrNew<F extends (...params: any) => any, N extends Constructor<any>>(func: F, construct: N): FuncOrNew<F, N> {
    return function (...params) {
        if (new.target) {
            return new construct(...params);
        } else {
            return func(...params);
        }
    } as any
}

function decOrFunc<D extends (target, context: DecoratorContext) => void, F extends (...params: any[]) => any>(decorator: D, func: F): D & F {
    return function (...params) {
        if (params.length == 2 && params[1].kind) {
            // @ts-ignore
            return decorator(...params);
        } else {
            return func(...params);
        }
    } as any
}

type WebhookMethods = "GET" | "POST" | "PUT" | "HEAD";
type WebhookPayload<T = any> = {
    payload: T,
    headers: Record<string, string>,
    params: Record<string, string>,
}

export function homeAssistantApi(options: { pluginId: string | HomeAssistantPlugin }) {
    const _plugin = pluginGetterFactory<HomeAssistantPlugin>(options.pluginId, homeAssistantApi.defaultPluginId);
    const _entity_store = () => getOrCreateLocalData(_plugin(), current.application, "entities", (plg, app) => new EntityStore(plg, app));

    // ========= Shared Entity Helpers ========= //
    async function registerEntity(entity: TDEntity<any>) {
        _entity_store().registerEntity(entity);
    }

    /** Register the Entity and (if created via decorator or initialize) add it to the auto-remove registry */
    async function registerEntityFromDecorator(entity: TDEntity<any>) {
        _entity_store().registerEntity(entity);

        if (current.application.state == 'starting') {
            // TODO Store a list of decorator-created entities. Destroy any that are no longer present
            //   Entries will need to track plugin type, plugin id, and any plugin/entry specific info
        }
    }

    function _linkFieldEntityBase<T extends TDEntity<any>>(
        construct: () => T,
        context: DecoratorContext,
        init_callback?: (self, ent: T) => void,
    ) {
        const ents = new WeakMap<any, T>();
        const get_linked = (self, init: boolean = false) => {
            if (init && !ents.has(self)) {
                init_linked(self);
            }
            return ents.get(self);
        }

        const init_linked = async (self) => {
            if (get_linked(self, false)) return;

            const ent = construct();
            init_callback?.(self, ent);
            ents.set(self, ent);

            await registerEntityFromDecorator(ent);
        }

        notePluginAnnotation(context, init_linked);

        return {
            get_linked,
            init_linked,
        }
    }

    function _linkFieldEntityClass<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        options: EntityClassOptions<E> & { id?: string },
        context: DecoratorContext,
        init_callback: (self, ent: E) => void,
    ) {
        return _linkFieldEntityBase(
            () => {
                const { id, ...rest } = options;
                return new ecls(id, rest as any);
            },
            context,
            init_callback,
        )
    }


    // ========= Read-Only Entity Helpers ========= //

    function _stateOnlyDecorator<E extends EntityClass<any, any>>(ecls: EntityClassConstructor<E>, options: EntityClassOptions<E> & { id?: string }) {
        return ((access, context: DecoratorContext) => {
            if (context.kind == 'getter') {
                const comptd = (computed as any)(access, context);

                _linkFieldEntityClass(ecls, options, context, (self, ent) => {
                    ent.getState = () => self[context.name];
                })

                return comptd;
            }

            if (context.kind == 'accessor') {
                const obsvd = (observable as any)(access, context);

                _linkFieldEntityClass(ecls, options, context, (self, ent) => {
                    ent.getState = () => (obsvd.get as Function).call(self);
                })

                return obsvd;
            }
        }) as ClassAccessorDecorator<Annotable, any> & ClassGetterDecorator<Annotable, any>
    }

    /** API Factory for creating RO entities with either `new` or decorator syntax */
    function stateOnlyApi<E extends EntityClass<any, any>>(entCls: EntityClassConstructor<E>) {
        return funcOrNew(
            (options: EntityClassOptions<E> & { id?: string }) => _stateOnlyDecorator(entCls, options),
            entCls,
        )
    }


    // ========= Read/Write Entity Helpers ========= //

    type RWInitCallback<E extends EntityClass<any, any, any>> = (self, entity: E, set: (v: EntityClassType<E>) => void) => void

    function _basicRWDecorator<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        options: EntityClassOptions<E> & { id?: string },
        init_callback: RWInitCallback<E>,
    ) {
        return ((access, context: DecoratorContext) => {
            const obsvd = (observable as any)(access, context);

            _linkFieldEntityClass(ecls, options, context, (self, ent) => {
                ent.getState = () => (obsvd.get as Function).call(self);
                const updateVal = (v) => (obsvd.set as Function).call(self, v);
                init_callback(self, ent, updateVal);
            })

            return obsvd;
        }) as ClassAccessorDecorator<Annotable, any>
    }

    /** API Factory for creating R/W entities with either `new` or decorator syntax */
    function basicRWApi<E extends EntityClass<any, any>>(entCls: EntityClassConstructor<E>, autoinit_callback: RWInitCallback<E>) {
        return funcOrNew(
            (options: EntityClassOptions<E> & { id?: string }) => _basicRWDecorator(entCls, options, autoinit_callback),
            entCls,
        )
    }


    // ========= Input Entity Helpers ========= //

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions<any> & O) {
        return ((access, context) => {
            const entity_id = resolveEntityId(domain, options, context);

            const { get_linked } = _linkFieldEntityBase(
                () => new InputEntity({ ...options, id: entity_id }),
                context
            )

            return {
                get() {
                    return get_linked(this, true).state;
                },
                set(value) {
                    get_linked(this, true).state = value;
                },
            } as any
        }) as ClassAccessorDecorator<Annotable, any>
    }

    /** API Factory for creating input entities with either `new` or decorator syntax */
    function inputApi<V, O extends {} = {}>(domain: string) {
        // TODO Should config be optional?
        return funcOrNew(
            (options: O) => _inputDecorator(domain, options),
            InputEntity,
        )
    }

    type Iso8601String = string;

    /** Create an `input_button` helper and trigger the decorated method when pressed */
    const _buttonDecorator = (options: ButtonOptions): ClassMethodDecorator => {
        return (func, context) => {
            const entity_id = resolveEntityId("input_button", options, context);

            notePluginAnnotation(context, async (self) => {
                const ent = new InputButton({ ...options, id: entity_id });
                await registerEntityFromDecorator(ent);

                // Listen to button press
                ent.on_pressed = () => client_call_safe(() => self[context.name]());
            })

            // @action()
            return action(func, context);
        }
    }


    // ========= Entity APIs ========= //

    const entities = {
        ...domain_entities,

        /** Create a `sensor` entity and update it whenever the decorated getter/accessor is updated */
        sensor: stateOnlyApi(domain_entities.sensor),

        /** Create a `binary_sensor` entity and update it whenever the decorated getter/accessor is updated */
        binary_sensor: stateOnlyApi(domain_entities.binary_sensor),

        // /** Create a `weather` entity and update it whenever the decorated getter/accessor is updated */
        // weather: stateOnlyDecorator<{}, {}>("weather"), // TODO Not supported by MQTT

        /** Create a `device_tracker` entity and update it whenever the decorated getter/accessor is updated */
        device_tracker: stateOnlyApi(domain_entities.device_tracker),

        // /** Create a `person` entity and update it whenever the decorated getter/accessor is updated */
        // person: stateOnlyDecorator<{}, string>("person"), // TODO Not supported by MQTT

        /** Create a `switch` entity and update it whenever the decorated getter/accessor is updated */
        switch: basicRWApi(domain_entities.switch, (app, entity, set) => {
            entity.on("turn_on", () => set(true));
            entity.on("turn_off", () => set(false));
        }),

        // TODO number, select, text, climate, light, cover
        //  Basically the same as the inputs, but state is kept in TD instead of HA
        //  Can be used as an accessor decorator, or as a constructor to register an X with custom service callbacks and state management
    }

    const input = {
        /** Create an `input_number` helper and sync it with the decorated accessor */
        number: inputApi<number, NumberInputOptions>("input_number"),

        /** Create an `input_text` helper and sync it with the decorated accessor */
        text: inputApi<string, { min?: number, max?: number, pattern?: string | RegExp, mode?: 'text' | 'password' }>("input_text"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        boolean: inputApi<boolean>("input_boolean"),

        /** Create an `input_boolean` helper and sync it with the decorated accessor */
        bool: inputApi<boolean>("input_boolean"),

        /** Create an `input_datetime` helper and sync it with the decorated accessor */
        datetime: inputApi<Date | number | Iso8601String, { has_date?: boolean, has_time?: boolean }>("input_datetime"),

        /** Create an `input_select` helper and sync it with the decorated accessor */
        select: funcOrNew(
            <const T extends string>(options: T[], config?: InputOptions<T>) => _inputDecorator("input_select", { options, ...config }),
            InputSelect,
        ),

        button: funcOrNew(_buttonDecorator, InputButton),
    }


    // ========= Service Helpers ========= //

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

    function sync_subscribe(message: MessageBase, callback: (value) => void) {
        let disposer;
        _plugin()._ha_api.subscribeMessage(callback, message, { resubscribe: true }).then(disp => {
            if (disposer) disp();
            disposer = disp;
        })
        const cleanups = current.application.cleanups.unorderedGroup("ha:subscriptions");
        return cleanups.addExposed(() => {
            if (disposer) disposer();
            disposer = true;
        })
    }

    /**
     * Start a websocket subscription with Home Assistant
     * 
     * Basically a passthrough of `subscribeMessage` from `home-assistant-js-websocket`
     */
    function subscribe<T>(msg: MessageBase) {
        function executor(callback: (payload: T) => void)
        function executor(target, context: ClassMethodDecoratorContext<any, (payload: T) => void>)
        function executor(target, context?: ClassMethodDecoratorContext) {
            if (context) {
                notePluginAnnotation(context, (self) => {
                    executor((payload) => {
                        self[context.name](payload);
                    })
                });
            } else {
                sync_subscribe(msg, target);
            }
        }
        return executor;
    }

    /**
     * Create a Home Assistant Webhook with the given ID. Will be available at http(s)://<Your HA URL>/api/webhook/<ID>.
     * 
     * Requires https://github.com/zachowj/hass-node-red/tree/main
     */
    function webhook<T>(id: string, options?: { allowed_methods?: WebhookMethods[], name?: string }) {
        function webhook_executor(callback: (payload: WebhookPayload<T>) => void)
        function webhook_executor(target, context: ClassMethodDecoratorContext<any, (payload: WebhookPayload<T>) => void>)
        function webhook_executor(target, context?: ClassMethodDecoratorContext) {
            if (context) {
                notePluginAnnotation(context, (self) => {
                    sync_subscribe({
                        type: "nodered/webhook",
                        server_id: "not used",
                        name: options?.name || context.name || id,
                        webhook_id: id,
                        allowed_methods: options?.allowed_methods || ['GET'],
                    }, (payload) => {
                        self[context.name](payload?.data);
                    })
                });
            } else {
                sync_subscribe({
                    type: "nodered/webhook",
                    server_id: "not used",
                    name: options?.name || id,
                    webhook_id: id,
                    allowed_methods: options?.allowed_methods || ['GET'],
                }, (payload) => target(payload?.data))
            }
        }

        return webhook_executor;
    }

    const _mqttApi = () => _plugin().mqttApi();

    return {
        _getPlugin: _plugin,
        get _plugin() { return _plugin() },

        /**
         * Returns the underlying Connection object from `home-assistant-js-websocket`.
         * This is advanced usage and should only be used if you know what you're doing.
         * You MUST handle disposal of any subscriptions or objects returned.
         */
        _getConnection: () => _plugin()._ha_api,
        /**
         * Returns the underlying Connection object from `home-assistant-js-websocket`.
         * This is advanced usage and should only be used if you know what you're doing.
         * You MUST handle disposal of any subscriptions or objects returned.
         */
        get _connection() { return _plugin()._ha_api },

        get states() { return _plugin().state },

        subscribe,
        webhook,

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

        registerEntity,
        entity: entities,
        input,
        button: input.button,
        callService,
        findRelatedEntities,
        // findRelatedDevices,
        toggleSwitch,
    }
}
homeAssistantApi.defaultPluginId = "home_assistant";

export type HomeAssistantApi = ReturnType<typeof homeAssistantApi>;

export const api = makeApiExport(homeAssistantApi)
