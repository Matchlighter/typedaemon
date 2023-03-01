
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

export const autorun = wrapAndTrack(mobx.autorun);
export const reaction = wrapAndTrack(mobx.reaction);
export const when = wrapAndTrack(mobx.when);

function swrapAndTrack<F extends (...args: any[]) => any>(f: F): (scope: { cleanups: LifecycleHelper }, ...rest: Parameters<F>) => ReturnType<F> {
    return ((scope, ...args: Parameters<F>): ReturnType<F> => {
        const disposer = f(...args);
        if (typeof disposer == 'function') {
            scope.cleanups.append(disposer)
        }
        return disposer
    });
}

export const smobx = {
    autorun: swrapAndTrack(mobx.autorun),
    reaction: swrapAndTrack(mobx.reaction),
    when: swrapAndTrack(mobx.when),
}
