import { Constructor } from "type-fest";
import { ApplicationInstance } from "../application_instance";
import { current } from "../current";

type ModuleMatcher = string | RegExp | ((id: string) => boolean);

export const PATCHES: { match: ModuleMatcher, apply: (mod: any) => any }[] = []

export function registerPatch(match: ModuleMatcher, apply: (mod: any) => any) {
    PATCHES.push({
        match,
        apply,
    })
}

export const UNREF_NOT_SUPPORTED = () => { throw new Error(".unref() is not supported in TypeDaemon apps!") }

interface CleanerPatchedClass {
    _application: ApplicationInstance;
    _cleaner: any;
}

export function patchClassCleanup<T extends Constructor<any>>(cls: T,  methods:( keyof InstanceType<T>)[], cleanup_logic: (instance: InstanceType<T>) => void): T {
    class PatchedClass extends cls implements CleanerPatchedClass {
        constructor(...args) {
            super(...args);

            this._application = current.application;
            current.application.cleanups.append(this._cleaner);
        }

        _application: ApplicationInstance;

        _cleaner = () => {
            cleanup_logic(this as any);
        }
    }

    for (let m of methods) {
        PatchedClass.prototype[m as any] = function (this: PatchedClass, ...args) {
            this._application.cleanups.remove(this._cleaner);
            return cls.prototype[m].call(this, ...args);
        }
    }

    return PatchedClass;
}

patchClassCleanup.markCleaned = (thing: any) => {
    const patched = thing as CleanerPatchedClass;
    patched._application.cleanups.remove(patched._cleaner);
}
