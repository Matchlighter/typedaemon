import * as path from "path";
import type { AppLifecycle } from "../common/shared_types";
import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { onAppLifecycle } from "./follow_app";
import type { LifecycleSource } from "./lifecycle_topic";
import type { LifecycleEvent } from "./protocol";

/** What the dashboard needs from the hypervisor (public API only) */
export type LifecycleHost = Pick<Hypervisor, 'working_directory' | 'listOrphanApplications' | 'watchConfigEntry' | 'on' | 'off'>;

/** Steps of the instance being started (as opposed to the one being shut down), which a restart cause explains */
const STARTING_STEPS = new Set<AppLifecycle>(['initializing', 'compiling', 'starting', 'started']);

/** Specifics of why an instance was restarted, where known (what changed) */
function causeDetail(host: LifecycleHost, app: ApplicationInstance): string | undefined {
    switch (app.startCause) {
        case 'source_change': return `Source changed: ${path.relative(host.working_directory, path.resolve(host.working_directory, app.options.source))}`;
        case 'config_change': {
            const [first, ...more] = app.startChanged ?? [];
            return `Config changed: ${app.id}${first ? `.${first}` : ''}${more.length ? ` (+${more.length} more)` : ''}`;
        }
    }
}

/**
 * Keeps the last `limit` app transitions (every lifecycle step, apps removed from config, resumables picked up again)
 * from the moment it is created, so it must be created once for the server's lifetime, not per subscription.
 * `dispose` detaches it.
 */
export function hypervisorLifecycleSource(host: LifecycleHost, limit = 200): LifecycleSource & { dispose(): void } {
    const events: LifecycleEvent[] = [];
    const listeners = new Set<(e: LifecycleEvent) => void>();
    let seq = 0;
    /** Last lifecycle step seen per app (transitional ones included), to say what each event transitioned from */
    const prev = new Map<string, AppLifecycle>();

    const record = (app: string, name: string, rest: Omit<LifecycleEvent, 'id' | 'ts' | 'app' | 'name'>) => {
        const event: LifecycleEvent = { id: ++seq, ts: Date.now(), app, name, ...rest };
        events.push(event);
        if (events.length > limit) events.splice(0, events.length - limit);
        listeners.forEach(cb => cb(event));
    };
    const nameOf = (app: ApplicationInstance) => app.options?.human_name || app.id;

    const offLifecycle = onAppLifecycle(host, undefined, (app, state) => {
        const from = prev.get(app.id);
        prev.set(app.id, state);
        const detail = STARTING_STEPS.has(state) && app.startCause ? causeDetail(host, app) : undefined;
        record(app.id, nameOf(app), {
            state,
            ...(from && { from }),
            ...(app.startCause && { cause: app.startCause }),
            ...(detail && { detail }),
            ...(state === 'dead' && app.lastError && {
                error: app.lastError.message,
                ...(app.lastError.logId !== undefined && { errorLogId: app.lastError.logId }),
            }),
        });
    });

    const onResumed = (app: ApplicationInstance, methods: string[]) => record(app.id, nameOf(app), {
        state: 'resumed', resumed: methods, detail: `Restored ${methods.length} resumable${methods.length === 1 ? '' : 's'} after restart`,
    });
    host.on('app_resumed', onResumed);

    // Orphans have no event of their own (and `orphans_changed` carries no id): diff the list when it may have changed
    let orphans: Set<string> | undefined;
    let scan: Promise<void> = Promise.resolve();
    const rescan = () => {
        scan = scan.then(async () => {
            let now: Set<string>;
            try { now = new Set(await host.listOrphanApplications()) } catch { return }
            if (orphans) {
                for (const id of now) {
                    if (!orphans.has(id)) record(id, id, { state: 'orphan', from: 'stopped', detail: 'Removed from config; leftovers kept for cleanup' });
                }
            }
            orphans = now;
        });
    };
    rescan();
    host.on('orphans_changed', rescan);
    const offConfig = host.watchConfigEntry('apps', rescan);

    return {
        recent: () => [...events],
        onEvent(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb) };
        },
        dispose() {
            offLifecycle();
            host.off('app_resumed', onResumed);
            host.off('orphans_changed', rescan);
            offConfig();
        },
    };
}
