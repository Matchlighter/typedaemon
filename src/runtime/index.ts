

import { appProxy } from "./application";
import { current } from "../hypervisor/current";

export { Application } from './application'
export * as lifecycle from "./lifescycle"
export * as schedule from './schedule'
export { sleep, sleep_until } from "./sleep"
export { persistence } from './persistence'
export { resumable } from './resumable'

export const get_internal_app = () => {
    return current.application;
}

/**
 * Retrieve a Proxy to an application instance for the given Application id
 */
export const get_app = (identifier: string) => {
    return appProxy(current.hypervisor, identifier);
}

export { get_plugin } from "../plugins/base"
