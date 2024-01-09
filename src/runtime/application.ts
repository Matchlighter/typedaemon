
import { ConditionalKeys } from "type-fest";
import { ApplicationInstance } from "../hypervisor/application_instance";
import { CrosscallConfig, CrossqueryConfig } from "../hypervisor/cross_call";
import { current } from "../hypervisor/current";
import { Hypervisor } from "../hypervisor/hypervisor";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { FallbackRequireRestart } from "../hypervisor/managed_config_events";

/**
 * Optional base class for custom applications. Provides some basics.
 */
export class Application<C = any> extends BaseInstanceClient<ApplicationInstance> {
    configuration_updated(new_config: C, old_config: C) {
        // Throw if this method isn't overridden, but don't throw if it's called via super
        if (this.configuration_updated == Application.prototype.configuration_updated) {
            throw new FallbackRequireRestart();
        }
    }

    get config() {
        return this[HyperWrapper].app_config;
    }
}

type AnyFunction = (...args: any[]) => any;
type AsFunc<F> = F extends AnyFunction ? F : never;

type ReturnPromise<T extends AnyFunction> = (...args: Parameters<T>) => Promise<ReturnType<T>>;
type AppProxyValue<T> = T extends AnyFunction ? ReturnPromise<T> : T;

export type AppProxy<T> = {
    readonly [K in keyof T]: AppProxyValue<T>;
}

export class ApplicationReference<A> {
    constructor(readonly uuid: string) {
        this._hv = current.hypervisor;
    }

    private _hv: Hypervisor;

    private get _current() {
        return this._hv.getApplication(this.uuid);
    }

    callMethod<M extends ConditionalKeys<A, (...args: any[]) => any>>(method: M, parameters: Parameters<AsFunc<A[M]>>, options?: CrosscallConfig): PromiseLike<ReturnType<AsFunc<A[M]>>> {
        return this._hv.crossCallStore.makeCrossAppCall(current.application, this.uuid, method as string, parameters, options);
    }

    readProperty<P extends keyof A>(property: P, options?: CrossqueryConfig): A[P] {
        return this._hv.crossCallStore.crossQueryProperty(current.application, this.uuid, property as string, options);
    }

    private _proxy;

    get proxy(): AppProxy<A> {
        this._proxy ??= this._makeProxy();
        return this._proxy;
    }

    protected _makeProxy() {
        const self = this;

        const assertPresent = (app: ApplicationInstance) => {
            if (!app) throw new Error(`No application ${this.uuid}!`);
        }

        return new Proxy({}, {
            get(target, p, receiver) {
                const source = current.application;
                const dest = self._current;

                assertPresent(dest);

                const constr = dest.constructor;
                if (typeof constr.prototype[p] == "function") {
                    return (...args) => self.callMethod(p as any, args as any, {

                    });
                }

                return self.readProperty(p as any, {
                    fallback: "throw",
                })
            },
        }) as any
    }
}
