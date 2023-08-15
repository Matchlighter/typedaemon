
import { observable } from "mobx";

import type { ClassAccessorDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { HyperWrapper } from "../../hypervisor/managed_apps";
import { PersistentEntryOptions } from "../../hypervisor/persistent_storage";
import { Application } from "../application";

/**
 * Mark a property as persistent - it's value will be saved to disk and restored when the app starts
 */
export const persistent = optional_config_decorator([{}], (options?: PersistentEntryOptions): ClassAccessorDecorator<Application, any> => {
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

