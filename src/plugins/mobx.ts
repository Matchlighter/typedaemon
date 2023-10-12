
import * as mobx from "mobx";
import { current } from "../hypervisor/current";
import { LifecycleHelper } from "../common/lifecycle_helper";
import { bind_callback_env } from "./base";

function wrap_disposer(scope: { cleanups: LifecycleHelper }, disposer: () => void): any {
    if (typeof disposer == 'function') {
        const cleanups = scope.cleanups.unorderedGroup("mobx:reactions");
        return cleanups.addExposed<typeof disposer>(() => {
            return disposer();
        })
    }
    return disposer;
}

function appWrapAndTrack<F extends (...args: any[]) => any>(f: F): F {
    return ((...args: Parameters<F>): ReturnType<F> => {
        const app = current.application;

        // Bind callback(s) to app (invoke)
        args = args.map(av => {
            if (typeof av == 'function') {
                return bind_callback_env(av);
            } else {
                return av;
            }
        }) as any

        const disposer = f(...args);
        return wrap_disposer(app, disposer)
    }) as any;
}

function wrap_computed(transform: (args: Parameters<typeof mobx['computed']>) => void): typeof mobx['computed'] {
    const make_wrapped = (f) => {
        const wrapped = (...args) => {
            transform(args as any);
            return f(...args);
        }

        Object.assign(wrapped, f);

        return wrapped;
    }

    const wrapped: typeof mobx['computed'] = make_wrapped(mobx.computed) as any;
    wrapped.struct = make_wrapped(mobx.computed.struct) as any;
    return wrapped;
}

/** MobX wrappers that automatically add disposers to the current Applications's cleanups */
export const appmobx: typeof mobx = {
    ...mobx,
    autorun: appWrapAndTrack(mobx.autorun),
    reaction: appWrapAndTrack(mobx.reaction),
    when: appWrapAndTrack(mobx.when),
    computed: wrap_computed((args) => { args[0] = bind_callback_env(args[0]) }),
}

function plgWrapAndTrack<F extends (...args: any[]) => any>(f: F): (scope: { cleanups: LifecycleHelper }, ...rest: Parameters<F>) => ReturnType<F> {
    return ((scope, ...args: Parameters<F>): ReturnType<F> => {
        const disposer = f(...args);
        return wrap_disposer(scope, disposer)
    });
}

/** MobX wrappers that automatically add disposers to the given Applications's cleanups */
export const plgmobx = {
    autorun: plgWrapAndTrack(mobx.autorun),
    reaction: plgWrapAndTrack(mobx.reaction),
    when: plgWrapAndTrack(mobx.when),
}
