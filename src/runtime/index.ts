

import { get_plugin as _get_plugin } from "../plugins/base";
import { ApplicationReference } from "./application";

export { Application } from './application';
export type { ApplicationReference } from './application';

export { app_current as current } from './app_current';
export * as lifecycle from "./lifescycle";
export { persistence } from './persistence';
export { resumable } from './resumable';
export * as schedule from './schedule';
export { sleep, sleep_until } from "./sleep";

/**
 * Retrieve a handle to an application instance for the given Application id
 */
export const get_app = <A = any>(identifier: string) => {
    return new ApplicationReference<A>(identifier);
}

/** Get the API for the specified plugin ID */
export const get_plugin = <P>(identifier: string): P => {
    // @ts-ignore
    return _get_plugin(identifier)?.getAPI();
}
