
import deepEqual = require("deep-eql");

import { BaseInstance, BaseInstanceClient } from "./managed_apps";

export interface CCHBaseInstanceClient<C> extends BaseInstanceClient<BaseInstance<C>> {
    configuration_updated(ncfg: C, ocfg: C);
}

export interface CCHPrehandlerContext<C> {
    handle<K extends keyof C>(key: K, handler?: (ncfg: C[K], ocfg: C[K]) => void)
    invoke_client_handler(ncfg, ocfg): void;
    unhandled(): any;
    ocfg: C;
    ncfg: C;
}

export class RequireRestart extends Error { }
export class FallbackRequireRestart extends RequireRestart { }

export function configChangeHandler<C>(instance: BaseInstance<C, CCHBaseInstanceClient<C>>, prehandle: (context: CCHPrehandlerContext<C>) => void, transform_for_client?: (any) => any) {
    return async (ncfg: C, ocfg: C) => {
        if (instance.state != 'started') return;

        instance.logMessage("debug", `Configuration updated, processing changes`);

        const unhandled_ncfg = { ...ncfg }, unhandled_ocfg = { ...ocfg }

        const prehandleContext: CCHPrehandlerContext<C> = {
            ncfg, ocfg,
            handle(key, handler?) {
                delete unhandled_ncfg[key];
                delete unhandled_ocfg[key];
                if (handler && !deepEqual(ncfg[key], ocfg[key])) {
                    return handler?.(ncfg[key], ocfg[key]);
                }
            },
            unhandled() {
                return [unhandled_ncfg, unhandled_ocfg];
            },
            async invoke_client_handler(ncfg2 = ncfg, ocfg2 = ocfg) {
                if (deepEqual(ncfg2, ocfg2)) return;

                try {
                    if (!instance.instance) throw new RequireRestart();
                    if (!instance.instance.configuration_updated) throw new RequireRestart();
                    await instance.invoke(() => instance.instance.configuration_updated(ncfg2, ocfg2));
                } catch (ex) {
                    if (ex instanceof RequireRestart) {
                        instance.logMessage("debug", `App determined that changes require a restart, restarting`);
                    } else {
                        instance.logMessage("error", `Error occurred while updating configuration:`, ex);
                    }
                    throw ex;
                }
            }
        }

        try {
            await prehandle(prehandleContext);
        } catch (ex) {
            if (ex instanceof RequireRestart) {
                await instance.namespace.reinitializeInstance(instance);
                return;
            } else {
                throw ex;
            }
        }
    }
}
