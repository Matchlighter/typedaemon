import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { Hypervisor } from "../hypervisor/hypervisor";
import type { ResumableInfo } from "../runtime/resumable/resumable_store";
import type { ScriptInfo } from "../runtime/script/registry";
import { followAppEmitter, type FollowAppHost } from "./follow_app";
import type { AppResumablesSource } from "./app_resumables_topic";
import type { AppResumablesSnapshot, ResumableRow, ScriptRow } from "./protocol";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppResumablesHost = Pick<Hypervisor, 'currentConfig' | 'getApplication' | 'on' | 'off'>;

/** Tab/overview counts: listed resumables (once the app has a store) and script runs that are running */
export function appResumableCounts(app: Pick<ApplicationInstance, 'resumableStore' | 'scripts'>) {
    const counts: { resumables?: number; scripts: number } = { scripts: app.scripts.list().reduce((n, s) => n + s.running, 0) };
    if (app.resumableStore) counts.resumables = app.resumableStore.list().length;
    return counts;
}

/** Which scripts are running and how many runs wait, for the overview card */
export function appScriptSummary(app: Pick<ApplicationInstance, 'scripts'>) {
    const list = app.scripts.list();
    return { running: list.filter(s => s.running > 0).map(s => s.name), queued: list.reduce((n, s) => n + s.queued, 0) };
}

/** `cb` fires when the app's resumables or scripts may have changed; follows restarts onto the new instance */
export function observeAppResumables(host: FollowAppHost, appId: string, cb: () => void): () => void {
    // The store of a starting instance does not exist yet: every lifecycle step rebinds
    return followAppEmitter(host, appId, cb, app => [app?.resumableStore, app?.scripts]);
}

const toResumableRow = (appId: string, r: ResumableInfo): ResumableRow => {
    const { id, owner, wait, failure, ...rest } = r;
    return {
        key: String(id),
        ...rest,
        // The app's own methods are owned by "the application"
        owner: owner === 'APPLICATION' ? appId : owner,
        ...(wait && { wait }),
        ...(failure && { failure }),
    };
};

const toScriptRow = (s: ScriptInfo): ScriptRow => ({
    key: s.name,
    mode: s.mode,
    limit: s.limit,
    running: s.running,
    queued: s.queued,
    runs: s.runs.map(r => ({ ...r, id: String(r.id) })),
});

const CANCEL_REASON = "Cancelled from the dashboard";

export function hypervisorAppResumablesSource(host: AppResumablesHost): AppResumablesSource & {
    cancel(appId: string, key: string): void;
    discard(appId: string, key: string): void;
    cancelRun(appId: string, script: string, run: string): void;
} {
    const known = (id: string) => {
        if (!host.getApplication(id) && !host.currentConfig.apps?.[id]) throw new Error(`Unknown app: ${id}`);
    };
    /** Acting needs the instance that holds the state in memory */
    const running = (id: string) => {
        known(id);
        const app = host.getApplication(id);
        if (!app?.resumableStore) throw new Error(`${id} is not running`);
        return app;
    };
    // A key that is not ours cannot name anything that exists
    const idOf = (key: string) => /^\d+$/.test(key) ? Number(key) : NaN;

    return {
        get(appId): AppResumablesSnapshot | undefined {
            const app = host.getApplication(appId);
            if (!app) return host.currentConfig.apps?.[appId] ? { resumables: [], scripts: [] } : undefined;
            return {
                // `resumableStore` exists only once the app got far enough to start
                resumables: app.resumableStore?.list().map(r => toResumableRow(appId, r)) ?? [],
                scripts: app.scripts.list().map(toScriptRow),
            };
        },

        onChange: (appId, cb) => observeAppResumables(host, appId, cb),

        cancel: (appId, key) => running(appId).resumableStore.cancel(idOf(key), CANCEL_REASON),
        discard: (appId, key) => running(appId).resumableStore.discard(idOf(key)),
        cancelRun: (appId, script, run) => running(appId).scripts.cancelRun(script, idOf(run), CANCEL_REASON),
    };
}
