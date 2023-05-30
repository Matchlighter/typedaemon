
import { current } from "../../hypervisor/current";
import { Application } from "../application"

interface CODReturnSignature<P extends any[], F extends (...params: any[]) => any> {
    (...params: P): ((decoratee: F) => void)
    (callback: F, ...params: P): ReturnType<F>
}

/**
 * Returns a function that wraps the given function, making it a registering call.
 * The returned function can be used directly or as a decorator.
 * 
 * ```ts
 * class App {
 *   initialize() {
 *     on_shutdown(() => {
 *       ...
 *     })
 *   }
 * 
 *   @on_shutdown
 *   do_this_at_shutdown() {
 *     ...
 *   }
 * }
 * ```
 */
function callback_or_decorator<const P extends any[], F extends (...params: any[]) => any>(func: (f: F, ...params: P) => void, default_params?: P): CODReturnSignature<P, F> {
    return ((...args) => {
        if (typeof args[0] != 'function') {
            const params = args as P;
            return (f: F, context: ClassMemberDecoratorContext) => {
                context.addInitializer(function (this: Application) {
                    func(f, ...params);
                })
            }
        } else {
            if ('kind' in args[1]) {
                args[1].addInitializer(function (this: Application) {
                    func(args[0], ...default_params);
                })
            } else {
                // @ts-ignore
                return func(...args);
            }
        }
    }) as any
}

/**
 * Helper to run logic when an application is shutting down. May be used as a decorator, or by passing a callback function.
 */
export const on_shutdown = callback_or_decorator((func) => {
    const instance = current.instance;
    current.instance.cleanups.append(() => {
        return instance.invoke(func);
    })
})
