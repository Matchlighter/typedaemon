
import { optional_config_decorator } from "@matchlighter/common_library/cjs/decorators/utils";

import { ClassAutoAccessorDecorator } from "../../common/decorator_fills";
import { current } from "../../hypervisor/application_instance"
import { Application, appProxy } from "../application";
import { PersistentEntryOptions } from "../../hypervisor/persistent_storage";
import { HyperWrapper } from "../../hypervisor/managed_apps";

export const get_internal_app = () => {
    return current.application;
}

export const get_app = (identifier: string) => {
    return appProxy(current.hypervisor, identifier);
}

export const get_plugin = <T>(identifier: string): T => {
    return current.hypervisor.getPlugin(identifier).instance as any;
}

export const persistent = optional_config_decorator([], (options?: PersistentEntryOptions): ClassAutoAccessorDecorator<Application, any> => {
    return ({ get, set }, context) => {
        // Imp 1 - Only stores the value in one place
        // TODO Apply @observable to persistedStorage
        // return {
        //     get() {
        //         const hva = this[HyperWrapper];
        //         return hva.persistedStorage[context.name];
        //     },
        //     set(value) {
        //         const hva = this[HyperWrapper];
        //         hva.markPersistedStorageDirty();
        //         hva.persistedStorage[context.name] = value;
        //     },
        // }

        // Imp 2 - Better support for nested decorators
        // TODO Apply @observable
        return {
            init(value) {
                const hva = this[HyperWrapper];
                if (context.name in hva.persistedStorage) {
                    return hva.persistedStorage[context.name];
                } else {
                    return value;
                }
            },
            set(value) {
                const hva = this[HyperWrapper];
                set.call(this, value);
                hva.persistedStorage.notifyValueChanged(context.name as string, value, options);
            },
        }
    }
})
