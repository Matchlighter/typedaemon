
import { observable } from "mobx";

import type { ClassAccessorDecorator } from "@matchlighter/common_library/decorators/20223fills";
import { optional_config_decorator } from "@matchlighter/common_library/decorators/utils";

import { chainedDecorators, dec_once } from "../common/decorators";
import { current } from "./../hypervisor/current";
import { HyperWrapper } from "./../hypervisor/managed_apps";
import { PersistentEntryOptions, PersistentStorage } from "./../hypervisor/persistent_storage";
import { Application } from "./application";

// TODO Autoclean @persistent entries

/**
 * Mark a property as persistent - it's value will be saved to disk and restored when the app starts
 */
export const persistent = optional_config_decorator([{}], (options?: Partial<PersistentEntryOptions> & { id?: string }): ClassAccessorDecorator<Application, any> => {
    return chainedDecorators([dec_once(observable), (access, context) => {
        const key = options.id || `@persistent-${String(context.name)}`;
        return {
            init(value) {
                const hva = this[HyperWrapper];
                if (hva.persistedStorage.hasKey(key)) {
                    value = hva.persistedStorage.getValue(key);
                }
                return value;
            },
            set(value) {
                const hva = this[HyperWrapper];
                access.set.call(this, value);
                hva.persistedStorage.setValue(key, value, { max_time_to_disk: 3, min_time_to_disk: 1, ...options })
            },
        }
    }])
})

const create_api = (storage: PersistentStorage) => {
    return {
        set(key: string, value: any, options?: Partial<PersistentEntryOptions>) {
            return storage.setValue(key, value, { min_time_to_disk: 1, max_time_to_disk: 3, ...options });
        },
        get(key: string) {
            return storage.getValue(key);
        },
        delete(key: string, options?: Partial<PersistentEntryOptions>) {
            return storage.setValue(key, undefined, { min_time_to_disk: 1, max_time_to_disk: 3, ...options });
        },
    }
}

export const persistence = {
    property: persistent,

    set(key: string, value: any, options?: Partial<PersistentEntryOptions>) {
        const ps = current.application.persistedStorage;
        return ps.setValue(key, value, { min_time_to_disk: 1, max_time_to_disk: 3, ...options });
    },
    get(key: string) {
        const ps = current.application.persistedStorage;
        return ps.getValue(key);
    },
    delete(key: string, options?: Partial<PersistentEntryOptions>) {
        const ps = current.application.persistedStorage;
        return ps.setValue(key, undefined, { min_time_to_disk: 1, max_time_to_disk: 3, ...options });
    },

    get shared() {
        const storage = current.hypervisor.sharedStorages.primary;
        return create_api(storage);
    },

    async load_namespace(key: string = "default") {
        const storage = await current.hypervisor.sharedStorages.load(key);
        // TODO Allow closing shared namespaces?
        return create_api(storage);
    }
}
