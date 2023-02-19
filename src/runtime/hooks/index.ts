
import { optional_config_decorator } from "@matchlighter/common_library/cjs/decorators/utils";

import { ClassAutoAccessorDecorator } from "../../common/decorator_fills";
import { current } from "../../hypervisor/application"
import { appProxy } from "../application";

export const get_app = (identifier: string) => {
    const hv = current.application.hypervisor;
    return appProxy(hv, identifier);
}

interface PersistentOptions {

}

export const persistent = optional_config_decorator([], (options?: PersistentOptions): ClassAutoAccessorDecorator<any, any> => {
    return ({ get, set }, context) => {
        return {
            set(value) {
                set.call(this, value);
                // TODO Write to persistent storage
            },
            init(value) {
                // TODO Read from persistent storage
            },
        }
    }
})
