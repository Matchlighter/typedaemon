
import { action, computed, observable } from "mobx";

import { ClassAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { HomeAssistantPlugin } from ".";
import { funcOrNew } from "../../common/alternative_calls";
import { chainedDecorators, dec_once } from "../../common/decorators";
import { current } from "../../hypervisor/current";
import { persistent } from "../../runtime/persistence";
import { Annotable, assert_application_context, client_call_safe, getOrCreateLocalData, notePluginAnnotation } from "../base";
import { ButtonOptions, InputButton, InputEntity, InputOptions, InputSelect, NumberInputOptions, TDEntity } from "./entity_api";
import { trackAutocleanEntity } from "./entity_api/auto_cleaning";
import { domain_entities } from "./entity_api/domains";
import { EntityClass, EntityClassConstructor, EntityClassOptions, EntityClassType } from "./entity_api/domains/base";
import type { TDButton } from "./entity_api/domains/button";
import type { TDScene } from "./entity_api/domains/scene";
import { EntityStore } from "./entity_api/store";

export interface EntityRegistrationOptions {
    /** If `true`, entity will be added to the auto-clean registry - if it's not registered again on the next app start up, it will be removed from HA */
    auto_clean?: boolean,
}

function separateRegistrationOptions<O extends {}>(opts: O & EntityRegistrationOptions) {
    const entity_options = opts;
    const registration_options = {};
    for (let k of ['auto_clean'] satisfies (keyof EntityRegistrationOptions)[]) {
        if (k in entity_options) {
            registration_options[k] = entity_options[k];
            delete entity_options[k];
        }
    }
    return {
        registration_options: registration_options as EntityRegistrationOptions,
        entity_options: entity_options as O,
    }
}

export const _entitySubApi = (_plugin: () => HomeAssistantPlugin) => {
    const _entity_store = () => {
        assert_application_context();
        return getOrCreateLocalData(_plugin(), current.application, "entities", (plg, app) => new EntityStore(plg, app));
    }

    // ========= Shared Entity Helpers ========= //
    /** Register the entity */
    async function registerEntity(entity: TDEntity<any>, options?: EntityRegistrationOptions) {
        const store = _entity_store();
        await store.registerEntity(entity);

        if (options?.auto_clean) {
            trackAutocleanEntity(store, entity);
        }
    }

    /** Register the Entity and (if created via decorator) add it to the auto-remove registry */
    async function registerEntityFromDecorator(entity: TDEntity<any>, options?: EntityRegistrationOptions) {
        return await registerEntity(entity, {
            auto_clean: current.application.state == 'starting',
            ...options,
        })
    }

    function _linkFieldEntityBase<T extends TDEntity<any>>(
        construct: () => T,
        context: DecoratorContext,
        roptions: EntityRegistrationOptions,
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

            await registerEntityFromDecorator(ent, roptions);
        }

        notePluginAnnotation(context, init_linked);

        return {
            get_linked,
            init_linked,
        }
    }

    function _linkFieldEntityClass<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        options: EntityClassOptions<E> & EntityRegistrationOptions & { id?: string },
        context: DecoratorContext,
        init_callback: (self, ent: E) => void,
    ) {
        const { entity_options, registration_options } = separateRegistrationOptions(options);
        return _linkFieldEntityBase(
            () => {
                const { id, ...rest } = entity_options;
                return new ecls(id || String(context.name), rest as any);
            },
            context,
            registration_options,
            init_callback,
        )
    }


    // ========= Read-Only Entity Helpers ========= //

    function _stateOnlyDecorator<E extends EntityClass<any, any>>(ecls: EntityClassConstructor<E>, options: EntityClassOptions<E> & EntityRegistrationOptions & { id?: string }) {
        return ((access, context: DecoratorContext) => {
            // TODO Allow values to be objects and interpret as state & attrs (probably implement in getState() and getExtraAttributes() overrides)

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
            (options: EntityClassOptions<E> & EntityRegistrationOptions & { id?: string }) => _stateOnlyDecorator(entCls, options),
            entCls,
        )
    }


    // ========= Read/Write Entity Helpers ========= //

    type RWInitCallback<E extends EntityClass<any, any, any>> = (self, entity: E, set: (v: EntityClassType<E>) => void) => void

    function _basicRWDecorator<E extends EntityClass<any, any>>(
        ecls: EntityClassConstructor<E>,
        _options: EntityClassOptions<E> & EntityRegistrationOptions & { id?: string, persist_state?: boolean },
        init_callback: RWInitCallback<E>,
    ) {
        const { persist_state, ...options } = _options
        return chainedDecorators([
            dec_once(observable),
            persist_state ? persistent : null,
            dec_once({ loud: true, key: "@ha.entity" }, (access, context: DecoratorContext) => {
                // TODO Allow values to be objects and interpret as state & attrs (probably implement in getState() and getExtraAttributes() overrides)
                _linkFieldEntityClass(ecls, options as any, context, (self, ent) => {
                    ent.getState = () => (access.get as Function).call(self);
                    const updateVal = (v) => (access.set as Function).call(self, v);
                    init_callback(self, ent, updateVal);
                })
            }),
        ]);
    }

    /** API Factory for creating R/W entities with either `new` or decorator syntax */
    function basicRWApi<E extends EntityClass<any, any>>(entCls: EntityClassConstructor<E>, autoinit_callback: RWInitCallback<E>) {
        return funcOrNew(
            (options: EntityClassOptions<E> & EntityRegistrationOptions & { id?: string, persist_state?: boolean }) => _basicRWDecorator(entCls, options, autoinit_callback),
            entCls,
        )
    }


    // ========= Misc Entity Helpers ========= //

    /** Create a `button` entity and trigger the decorated method when pressed */
    const _buttonDecorator = (options: EntityClassOptions<TDButton> & EntityRegistrationOptions & { id?: string }): ClassMethodDecorator => {
        return (func, context) => {
            _linkFieldEntityClass(domain_entities.button, options, context, (self, btn: TDButton) => {
                // Listen to button press
                btn.on_pressed = () => client_call_safe(() => self[context.name]());
            })

            // @action()
            return action(func, context);
        }
    }

    /** Create a `scene` entity and trigger the decorated method when triggered */
    const _sceneDecorator = (options: EntityClassOptions<TDScene> & EntityRegistrationOptions & { id?: string }): ClassMethodDecorator => {
        return (func, context) => {
            _linkFieldEntityClass(domain_entities.scene, options, context, (self, scene: TDScene) => {
                // Listen to button press
                scene.on_pressed = () => client_call_safe(() => self[context.name]());
            })

            // @action()
            return action(func, context);
        }
    }


    // ========= Input Entity Helpers ========= //

    function _inputDecorator<O extends {} = {}>(domain: string, options: InputOptions<any> & O) {
        return ((access, context) => {
            const { entity_options, registration_options } = separateRegistrationOptions(options);

            const { get_linked } = _linkFieldEntityBase(
                () => new InputEntity(entity_options.id || String(context.name), { domain, ...entity_options }),
                context,
                registration_options,
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
        class TIEnt extends InputEntity<V> {
            static domain = domain;
        }

        return funcOrNew(
            (options: O & EntityRegistrationOptions) => _inputDecorator(domain, options),
            TIEnt as typeof InputEntity<V>,
        )
    }

    type Iso8601String = string;

    /** Create an `input_button` helper and trigger the decorated method when pressed */
    const _inputButtonDecorator = (options: ButtonOptions & EntityRegistrationOptions): ClassMethodDecorator => {
        const { entity_options, registration_options } = separateRegistrationOptions(options);

        return (func, context) => {
            notePluginAnnotation(context, async (self) => {
                const ent = new InputButton(entity_options.id || String(context.name), { ...entity_options });
                await registerEntityFromDecorator(ent, registration_options);

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

        /** Create a `image` entity and update it whenever the decorated getter/accessor is updated */
        image: stateOnlyApi(domain_entities.image),

        // /** Create a `person` entity and update it whenever the decorated getter/accessor is updated */
        // person: stateOnlyDecorator<{}, string>("person"), // TODO Not supported by MQTT

        /** Create a `switch` entity and update it whenever the decorated getter/accessor is updated */
        switch: basicRWApi(domain_entities.switch, (app, entity, set) => {
            entity.handle_command = (v) => {
                set(v == "ON");
            }
        }),

        /** Create a `select` entity and update it whenever the decorated getter/accessor is updated */
        select: basicRWApi(domain_entities.select, (app, entity, set) => {
            entity.handle_command = set;
        }),

        /** Create a `number` entity and update it whenever the decorated getter/accessor is updated */
        number: basicRWApi(domain_entities.number, (app, entity, set) => {
            entity.handle_command = set;
        }),

        /** Create a `text` entity and update it whenever the decorated getter/accessor is updated */
        text: basicRWApi(domain_entities.text, (app, entity, set) => {
            entity.handle_command = set;
        }),

        // TODO climate, light, cover
        //  Basically the same as the inputs, but state is kept in TD instead of HA
        //  Can be used as an accessor decorator, or as a constructor to register an X with custom service callbacks and state management

        button: funcOrNew(_buttonDecorator, domain_entities.button),
        scene: funcOrNew(_sceneDecorator, domain_entities.scene),
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

        button: funcOrNew(_inputButtonDecorator, InputButton),
    }

    const entity = optional_config_decorator([{}], (options: EntityRegistrationOptions) => (target, context: ClassFieldDecoratorContext) => {
        notePluginAnnotation(context, (self) => {
            const ent = self[context.name];
            if (ent) registerEntity(ent)
        })
    })

    return {
        entities,
        input,

        /** Field decorator to automatically register the Entity after `initialize` */
        entity,

        _entity_store,
        registerEntity,

        api_factories: {
            basicRWApi,
            stateOnlyApi,
            inputApi,
        }
    }
}
