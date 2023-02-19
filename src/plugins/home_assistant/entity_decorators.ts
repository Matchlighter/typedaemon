
import { optional_config_decorator } from "@matchlighter/common_library/cjs/decorators/utils"
import { ClassAutoAccessorDecorator, ClassGetterDecorator, ClassMethodDecorator } from "../../common/decorator_fills"

interface EntityOptions {
    uuid?: string;
    friendly_name?: string;

    [key: string]: any;
}

interface FullState<V> {
    state: V;
    [key: string]: any;
}

function stateOnlyDecorator<O extends {}, V>(domain: string) {
    return optional_config_decorator([], (options?: EntityOptions & O): ClassGetterDecorator<any, V | FullState<V>> => {
        return (get, context) => {
            context.addInitializer(() => {
                reaction(() => get.call(this), v => {
                    let state: V = v;
                    let rest: any;
                    if ('state' in v) {
                        const { state: nstate, ...therest } = v;
                        state = nstate,
                            rest = therest;
                    }
                    // TODO Push to HA
                })
            })
            // TODO @computed
        }
    });
}

export const sensor = stateOnlyDecorator<{}, number>("sensor");
export const binary_sensor = stateOnlyDecorator<{}, boolean>("binary_sensor");
export const text_sensor = stateOnlyDecorator<{}, string>("text_sensor");
export const weather = stateOnlyDecorator<{}, {}>("weather");
export const device_tracker = stateOnlyDecorator<{}, string>("device_tracker");
export const person = stateOnlyDecorator<{}, string>("person");

interface InputOptions extends EntityOptions {
    /** Whether the state of the property should update immediately, or if it should wait for HA to confirm the updated value */
    optimistic?: boolean;
    /**
     * By default, Typedaemon will look for and link an existing entity, or create one if it doesn't exist.
     * Setting this to `true` will prevent the creation of an entity, setting it to `false` will assert that the entity doesn't already exist
     */
    existing?: boolean;
}

function inputDecorator<V, O extends {} = {}>(domain: string) {
    return optional_config_decorator([], (options?: InputOptions & O): ClassAutoAccessorDecorator<any, V | FullState<V>> => {
        return ({ get, set }, context) => {
            context.addInitializer(() => {
                // TODO Listen to HA
            })
            // TODO @observable()
            return {
                set(value) {
                    if (options.optimistic) {
                        set.call(this, value);
                    }
                    // TODO Write to HA
                },
                init(value) {
                    // TODO Read from HA
                },
            } as any
        }
    });
}

type Iso8601String = string;

export const input = {
    number: inputDecorator<number>("input_number"),
    text: inputDecorator<string>("input_text"),
    boolean: inputDecorator<boolean>("input_boolean"),
    bool: inputDecorator<boolean>("input_boolean"),
    datetime: inputDecorator<Date | number | Iso8601String>("input_datetime"),
}

interface ButtonOptions extends EntityOptions {

}

export const button = optional_config_decorator([], (options?: ButtonOptions): ClassMethodDecorator => {
    return (func, context) => {
        context.addInitializer(() => {
            // TODO Register HA entity
        })
        // TODO @action()
    }
})
