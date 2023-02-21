
import { AppLifecycle, ApplicationInstance, FallbackRequireRestart } from "../hypervisor/application";
import { Hypervisor } from "../hypervisor/hypervisor";

export const HyperWrapper = Symbol("Hypervisor Application");

export class Application<C = any> {
    constructor(hyper_wrapper: ApplicationInstance) {
        this[HyperWrapper] = hyper_wrapper;
    }

    initialize() { }
    shutdown() { }

    [HyperWrapper]: ApplicationInstance;

    configuration_updated(new_config: C, old_config: C) {
        throw new FallbackRequireRestart();
    }

    get config() {
        return this[HyperWrapper].app_config;
    }
}

type PromiseProxy<T> = { [K in keyof T]: Promise<T[K]> }

export function _appProxy(hv: Hypervisor, appid: string, useAsync: boolean): any {
    const base = {
        // Ideally users shouldn't keep references to other apps around, but...
        get _current() {
            return hv.getApplication(appid)
        }
    }

    const assertPresent = (app: ApplicationInstance) => {
        if (!app) throw new Error(`No application ${appid}!`);
    }

    let appDo: (f: (app: ApplicationInstance) => any) => any;

    if (useAsync) {
        appDo = async (f) => {
            const app = base._current;
            assertPresent(app);

            if (app.state == 'starting') {
                await new Promise((accept, reject) => {
                    function handle(status: AppLifecycle) {
                        if (status == 'started') {
                            accept(undefined);
                        } else {
                            reject();
                        }
                    }
                    app.once('lifecycle', handle);
                });
            } else if (app.state != 'started') {
                // This shouldn't occur if the app is just being rebooted
                throw new Error("Application is dead or stopping!")
            }

            return app.invoke(f, app);
        }
    } else {
        appDo = (f) => {
            const app = base._current;
            assertPresent(app);
            if (app.state != "started") throw new Error("Application is not ready!")
            return app.invoke(f, app);
        }
    }

    return new Proxy({}, {
        get(target, p, receiver) {
            return appDo((app) => {
                let v = Reflect.get(app, p);
                if (typeof v == 'function') {
                    v = (...args) => {
                        return app.invoke(v, ...args)
                    }
                }
                return v;
            })
        },
        set(target, p, newValue, receiver) {
            return appDo((c) => Reflect.set(c, p, newValue))
        },
        has(target, p) {
            return appDo((c) => Reflect.has(c, p))
        },
    }) as any
}

export function appProxy<T extends Application>(hv: Hypervisor, appid: string) {
    return _appProxy(hv, appid, false) as T;
}

export function appProxyAsync<T extends Application>(hv: Hypervisor, appid: string) {
    return _appProxy(hv, appid, true) as PromiseProxy<T>;
}
