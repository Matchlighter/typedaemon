
import { ApplicationInstance } from "../hypervisor/application";
import { Hypervisor } from "../hypervisor/hypervisor";
import { ResumablePromise, Suspend } from "./resumable_promise"

export const HyperWrapper = Symbol("Hypervisor Application");

export class Application {
    constructor(hyper_wrapper: ApplicationInstance) {
        this[HyperWrapper] = hyper_wrapper;
    }

    [HyperWrapper]: ApplicationInstance;

    private _shutdownRequested = false;
    get shutdownRequested() { return this._shutdownRequested }

    requestShutdown() {
        this._shutdownRequested = true;
    }
}

export function appProxy(hv: Hypervisor, appid: string): Application {
    const base = {
        get _current() {
            return hv.getApplication(appid)
        }
    }
    return new Proxy({}, {
        get(target, p, receiver) {
            return Reflect.get(base._current, p);
        },
        set(target, p, newValue, receiver) {
            return Reflect.set(base._current, p, newValue);
        },
        has(target, p) {
            return Reflect.has(base._current, p);
        },
    }) as any
}
