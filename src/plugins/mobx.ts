
import * as mobx from "mobx";
import { current } from "../hypervisor/current";
import { LifecycleHelper } from "../common/lifecycle_helper";

function wrapAndTrack<F extends (...args: any[]) => any>(f: F): F {
    return ((...args: Parameters<F>): ReturnType<F> => {
        const disposer = f(...args);
        if (typeof disposer == 'function') {
            current.application.cleanups.append(disposer);
        }
        return disposer
    }) as any;
}

// TODO Do we need to invoke()?

/** MobX wrappers that automatically add disposers to the current Applications's cleanups */
export const appmobx: typeof mobx = {
    ...mobx,
    autorun: wrapAndTrack(mobx.autorun),
    reaction: wrapAndTrack(mobx.reaction),
    when: wrapAndTrack(mobx.when),
}

function swrapAndTrack<F extends (...args: any[]) => any>(f: F): (scope: { cleanups: LifecycleHelper }, ...rest: Parameters<F>) => ReturnType<F> {
    return ((scope, ...args: Parameters<F>): ReturnType<F> => {
        const disposer = f(...args);
        if (typeof disposer == 'function') {
            scope.cleanups.append(disposer)
        }
        return (() => {
            scope.cleanups.remove(disposer);
            return disposer();
        }) as any
    });
}

/** MobX wrappers that automatically add disposers to the given Applications's cleanups */
export const plgmobx = {
    autorun: swrapAndTrack(mobx.autorun),
    reaction: swrapAndTrack(mobx.reaction),
    when: swrapAndTrack(mobx.when),
}
