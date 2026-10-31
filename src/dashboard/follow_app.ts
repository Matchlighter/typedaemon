import type { AppLifecycle } from "../common/shared_types";
import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { Hypervisor } from "../hypervisor/hypervisor";

export type FollowAppHost = Pick<Hypervisor, 'getApplication' | 'on' | 'off'>;

/** `cb` on every lifecycle step of app `id` (of any app when omitted). Returns the unsubscribe */
export function onAppLifecycle(
    host: Pick<Hypervisor, 'on' | 'off'>,
    id: string | undefined,
    cb: (app: ApplicationInstance, state: AppLifecycle) => void,
): () => void {
    const listener = (app: ApplicationInstance, state: AppLifecycle) => {
        if (id === undefined || app.id === id) cb(app, state);
    };
    host.on('app_lifecycle', listener);
    return () => { host.off('app_lifecycle', listener) };
}

/**
 * Keeps `bind` attached to app `appId`'s current instance across restarts (a restart is a new instance).
 * `bind` returns its unbinder, called before each rebind and on stop. `cb` fires after every lifecycle step of the app.
 * `bind` also gets the lifecycle state it was rebound for (undefined on the initial bind).
 */
export function followAppInstance(
    host: FollowAppHost,
    appId: string,
    bind: (app: ApplicationInstance | undefined, state?: string) => (() => void) | void,
    cb: () => void,
): () => void {
    let unbind: () => void = () => { };
    const rebind = (app: ApplicationInstance | undefined, state?: string) => {
        unbind();
        unbind = bind(app, state) || (() => { });
    };
    const offLifecycle = onAppLifecycle(host, appId, (app, state) => {
        rebind(app, state);
        cb();
    });
    rebind(host.getApplication(appId));
    return () => {
        offLifecycle();
        unbind();
    };
}

/** Anything that emits a no-argument `change` */
export interface ChangeEmitter {
    on(event: 'change', cb: () => void): unknown;
    off(event: 'change', cb: () => void): unknown;
}

/**
 * `cb` fires whenever any of the emitters `emittersOf` picks from app `appId`'s current instance emits `change`, and
 * after every lifecycle step of the app (the emitters of a starting instance may not exist yet: every step re-picks them)
 */
export function followAppEmitter(
    host: FollowAppHost,
    appId: string,
    cb: () => void,
    emittersOf: (app: ApplicationInstance | undefined) => (ChangeEmitter | undefined)[],
): () => void {
    return followAppInstance(host, appId, app => {
        const emitters = emittersOf(app).filter((e): e is ChangeEmitter => !!e);
        emitters.forEach(e => e.on('change', cb));
        return () => emitters.forEach(e => e.off('change', cb));
    }, cb);
}

/** Returns a checker that calls `cb` only if `read()` (compared by JSON) differs from the last time it was checked; for noisy event sources */
export function onDistinct<T>(read: () => T, cb: () => void): () => void {
    const key = () => JSON.stringify(read());
    let last = key();
    return () => {
        const now = key();
        if (now === last) return;
        last = now;
        cb();
    };
}
