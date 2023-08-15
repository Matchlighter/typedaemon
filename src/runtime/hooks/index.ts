

import { current } from "../../hypervisor/current";
import { appProxy } from "../application";

export const get_internal_app = () => {
    return current.application;
}

/**
 * Retrieve a Proxy to an application instance for the given Application id
 */
export const get_app = (identifier: string) => {
    return appProxy(current.hypervisor, identifier);
}

/**
 * Retrieve the plugin instance for the given Plugin id
 */
export const get_plugin = <T>(identifier: string): T => {
    return current.hypervisor.getPlugin(identifier)?.instance as any;
}

