
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";
import type { ClassAccessorDecorator } from "@matchlighter/common_library/decorator_fills";

import { Application, appProxy } from "../application";
import { PersistentEntryOptions } from "../../hypervisor/persistent_storage";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import { current } from "../../hypervisor/current";
import { observable } from "mobx";

export const get_internal_app = () => {
    return current.application;
}

/**
 * Retrieve a Proxy to an application instance for the given Application id
 */
export const get_app = (identifier: string) => {
    return appProxy(current.hypervisor, identifier);
}

/**
 * Retrieve the plugin instance for the given Plugin id
 */
export const get_plugin = <T>(identifier: string): T => {
    return current.hypervisor.getPlugin(identifier)?.instance as any;
}

/**
 * Mark a property as persistent - it's value will be saved to disk when set and restored when the app starts
 */
export const persistent = optional_config_decorator([], (options?: PersistentEntryOptions): ClassAccessorDecorator<Application, any> => {
    return (accessor, context) => {
        const obsvd = (observable as any)(accessor, context);
        return {
            ...obsvd,
            init(value) {
                if (obsvd.init) value = obsvd.init.call(this, value);
                const hva = this[HyperWrapper];
                if (context.name in hva.persistedStorage) {
                    return hva.persistedStorage[context.name];
                } else {
                    return value;
                }
            },
            set(value) {
                const hva = this[HyperWrapper];
                obsvd.set.call(this, value);
                hva.persistedStorage.notifyValueChanged(context.name as string, value, options);
            },
        }
    }
})
