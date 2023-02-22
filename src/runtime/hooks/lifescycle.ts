
import { current } from "../../hypervisor/application_instance"
import { Application } from "../application"

interface CODReturnSignature<P extends any[], F extends (...params: any[]) => any> {
    (...params: P): ((decoratee: F) => void)
    (callback: F, ...params: P): ReturnType<F>
}

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

export const on_shutdown = callback_or_decorator((func) => {
    current.application.cleanupTasks.mark(func);
})
