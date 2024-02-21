

import { HyperWrapper } from "../hypervisor/managed_apps";
import { NoSuchPluginError, Plugin, PluginNotStartedError, get_plugin as _get_plugin } from "../plugins/base";
import { ApplicationReference } from "./application";

export { Application } from './application';
export type { ApplicationReference } from './application';

export { app_current as current } from './app_current';
export * as lifecycle from "./lifescycle";
export { persistence } from './persistence';
export { resumable } from './resumable';
export * as schedule from './schedule';
export { sleep, sleep_until } from "./sleep";

export * as func from "./func";

/**
 * Retrieve a handle to an application instance for the given Application id
 */
export const get_app = <A = any>(identifier: string) => {
    return new ApplicationReference<A>(identifier);
}

/** Get the API for the specified plugin ID */
export const get_plugin = <P>(identifier: string): P => {
    const pl = _get_plugin<Plugin>(identifier);
    if (!pl) throw new NoSuchPluginError(identifier);
    if (pl[HyperWrapper].state != "started") throw new PluginNotStartedError(identifier);
    return pl.getAPI();
}

get_plugin.or_null = <P>(identifier: string): P => {
    // @ts-ignore
    return _get_plugin<P>(identifier).getAPI();
}
