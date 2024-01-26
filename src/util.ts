import { notePluginAnnotation } from "./plugins/base";

export type CODReturnSignature<P extends any[], F extends (...params: any[]) => any> = {
    (callback: F, ...params: P): ReturnType<F>
    (...params: P): ((decoratee: F, ctx?: DecoratorContext) => void)
} & (P['length'] extends 0 ? {
    // Allow @decorator without parameters if there are no params
    (decoratee: F, ctx?: DecoratorContext): void
} : {})

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
export function callback_or_decorator<const P extends any[], F extends (...params: any[]) => any>(func: (f: F, ...params: P) => void, default_params?: P): CODReturnSignature<P, F> {
    return ((...args) => {
        if (typeof args[0] != 'function') {
            const params = args as P;
            return (f: F, context: ClassMemberDecoratorContext) => {
                notePluginAnnotation(context, (self) => {
                    const inst_method = self[context.name];
                    func(inst_method, ...params);
                })
                // TODO Remove after testing notePluginAnnotation implementation
                // context.addInitializer(function (this: Application) {
                //     func(f, ...params);
                // })
            }
        } else {
            if ('kind' in args[1]) {
                notePluginAnnotation(args[1], (self) => {
                    const inst_method = self[args[1].name];
                    func(inst_method, ...default_params);
                })
                // TODO Remove after testing notePluginAnnotation implementation
                // args[1].addInitializer(function (this: Application) {
                //     func(args[0], ...default_params);
                // })
            } else {
                // @ts-ignore
                return func(...args);
            }
        }
    }) as any
}

export function int_callback_or_decorator<F extends (...params: any[]) => any, R>(func: (f: F) => R): COD2ReturnSignatureDirect<any, F, R> {
    return ((...args) => {
        if (args.length == 1) {
            return func(args[0]);
        } else {
            notePluginAnnotation(args[1], (self) => {
                const inst_method: Function = self[args[1].name];
                func(inst_method.bind(self));
            })
        }
    }) as any
}

type COD2ReturnSignatureBase<P extends any[], F extends (...params: any[]) => any, R> = {
    (...params: P): {
        (callback: F): R
        (decoratee: F, ctx: DecoratorContext): void
    }
}
type COD2ReturnSignatureDirect<P extends any[], F extends (...params: any[]) => any, R> = {
    (callback: F): R
    (decoratee: F, ctx: DecoratorContext): void
}

type COD2ReturnSignature<P extends any[], F extends (...params: any[]) => any, R> = COD2ReturnSignatureBase<P,F,R> & (P['length'] extends 0 ? COD2ReturnSignatureDirect<P,F,R> : {})
type COD2ReturnSignatureWithDirect<P extends any[], F extends (...params: any[]) => any, R> = COD2ReturnSignatureBase<P,F,R> & COD2ReturnSignatureDirect<P,F,R>

export function callback_or_decorator2<const P extends any[], F extends (...params: any[]) => any, R>(func: (f: F, ...params: P) => R): COD2ReturnSignature<P, F, R>
export function callback_or_decorator2<const P extends any[], F extends (...params: any[]) => any, R>(func: (f: F, ...params: P) => R, default_params: P): COD2ReturnSignatureWithDirect<P, F, R>
export function callback_or_decorator2<const P extends any[], F extends (...params: any[]) => any, R>(func: (f: F, ...params: P) => R, default_params?: P): COD2ReturnSignature<P, F, R> {
    return ((...args) => {
        if (typeof args[0] == 'function' && (args.length == 1 || 'kind' in args[1])) {
            if (default_params == null) {
                throw new Error(`Cannot call ${func.name} directly - must include parameters`)
            }

            // Immediate-use call
            if (args.length == 1) {
                // @ts-ignore
                return func(args[0], default_params);
            } else {
                notePluginAnnotation(args[1], (self) => {
                    const inst_method: Function = self[args[1].name];
                    func(inst_method.bind(self), ...default_params);
                })
            }
        } else {
            // Parametric call
            const params = args as P;
            return (target, context?) => {
                if (!context) {
                    return func(target, ...params);
                } else {
                    notePluginAnnotation(context, (self) => {
                        const inst_method: Function = self[context.name];
                        func(inst_method.bind(self), ...params);
                    })
                }
            }
        }
    }) as any
}

export function internal_sleep(ms: number) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}
