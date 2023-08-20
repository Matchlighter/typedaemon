
import { observable } from "mobx";

import type { ClassAccessorDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { HyperWrapper } from "../../hypervisor/managed_apps";
import { PersistentEntryOptions } from "../../hypervisor/persistent_storage";
import { Application } from "../application";

/**
 * Mark a property as persistent - it's value will be saved to disk and restored when the app starts
 */
export const persistent = optional_config_decorator([{}], (options?: Partial<PersistentEntryOptions> & { id?: string }): ClassAccessorDecorator<Application, any> => {
    return (accessor, context) => {
        const obsvd = (observable as any)(accessor, context);
        const key = options.id || `@persistent-${String(context.name)}`;
        return {
            ...obsvd,
            init(value) {
                const hva = this[HyperWrapper];
                if (hva.persistedStorage.hasKey(key)) {
                    value = hva.persistedStorage.getValue(key);
                }
                return obsvd.init.call(this, value);
            },
            set(value) {
                const hva = this[HyperWrapper];
                obsvd.set.call(this, value);
                hva.persistedStorage.setValue(key, value, { max_time_to_disk: 3, min_time_to_disk: 1, ...options})
            },
        }
    }
})
