
import { current } from "../hypervisor/current";
import { callback_or_decorator2 } from "../plugins/util";

/**
 * Helper to run logic when the application finishes initializing and is considered fully started.
 */
export const on_started = callback_or_decorator2((func: () => void) => {
    const instance = current.application;

    if (instance.state != "starting") {
        throw new Error("Can only register on_start hooks while the application is starting")
    }

    instance.addLifeCycleHook("started", func);
}, [])

/**
 * Helper to run logic when an application is shutting down.
 */
export const on_shutdown = callback_or_decorator2((func: () => void) => {
    const instance = current.instance;
    instance.cleanups.append(() => {
        return instance.invoke(func);
    })
}, [])
