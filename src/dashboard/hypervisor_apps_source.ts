import * as path from "path";
import type { ApplicationInstance } from "../hypervisor/application_instance";
import { listOrphanIds } from "../hypervisor/orphan_apps";
import type { Hypervisor } from "../hypervisor/hypervisor";
import type { AppsChange, AppsSource } from "./apps_topic";
import { appEntityCounts, observeEntityEvents } from "./hypervisor_app_entities_source";
import { orphanSummary } from "./hypervisor_orphan_source";
import type { AppRow, OrphanRow } from "./protocol";
import { onAppLifecycle } from "./follow_app";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppsHost = Pick<Hypervisor, 'working_directory' | 'operations_directory' | 'defaultAppOperatingDirectory' | 'defaultAppPersistenceFile' | 'currentConfig' | 'listApplications' | 'getApplication' | 'isApplicationStopped' | 'listPlugins' | 'watchConfigEntry' | 'on' | 'off'>;

type InstanceInfo = Pick<ApplicationInstance, 'id' | 'options' | 'state' | 'stateSince' | 'lastError' | 'isThickApp' | 'resumableStore' | 'schedules'>;

const relSource = (wd: string, source: string) => path.relative(wd, path.resolve(wd, source));

function instanceRow(app: InstanceInfo, host: AppsHost): AppRow {
    const wd = host.working_directory;
    const row: AppRow = {
        id: app.id,
        name: app.options.human_name || app.id,
        source: relSource(wd, app.options.source),
        kind: app.isThickApp ? 'thick' : 'lite',
        state: app.state,
        since: app.stateSince,
    };
    if (host.isApplicationStopped(app.id)) row.stoppedOverride = true;
    if (app.lastError) row.error = { message: app.lastError.message, phase: app.lastError.phase };
    // resumableStore exists only once the app got far enough to start
    if (app.resumableStore) {
        const resumables = app.resumableStore.list();
        row.resumables = resumables.length;
        const failed = resumables.filter(r => r.failure).length;
        if (failed) row.failedResumes = failed;
    }
    row.schedules = app.schedules.list().length;
    const entities = appEntityCounts(host, app as ApplicationInstance);
    if (entities) {
        row.entities = entities.entities;
        if (entities.unlinkedEntities) row.unlinkedEntities = entities.unlinkedEntities;
    }
    return row;
}

const configuredApps = (host: AppsHost) => host.currentConfig.apps || {};

/** Row for an app that has no live instance (stopped, or between instances) */
function configRow(host: AppsHost, id: string): AppRow {
    const cfg = configuredApps(host)[id];
    const row: AppRow = { id, name: cfg.human_name || id, source: relSource(host.working_directory, cfg.source), state: 'stopped', since: Date.now() };
    if (host.isApplicationStopped(id)) row.stoppedOverride = true;
    return row;
}

/** Current row for one configured or live app, or undefined if the id is unknown */
export function hypervisorAppRow(host: AppsHost, id: string): AppRow | undefined {
    const live = host.listApplications().find(a => a.id === id);
    if (live) return instanceRow(live, host);
    return id in configuredApps(host) ? configRow(host, id) : undefined;
}

export function hypervisorAppsSource(host: AppsHost): AppsSource {
    const configured = () => configuredApps(host);

    const list = (): AppRow[] => {
        const live = new Map(host.listApplications().map(a => [a.id, a]));
        const rows = Object.keys(configured()).map((id): AppRow => live.has(id) ? instanceRow(live.get(id), host) : configRow(host, id));
        // Live but no longer configured: stopping/dead leftovers of a just-removed app
        for (const [id, app] of live) if (!(id in configured())) rows.push(instanceRow(app, host));
        return rows;
    };

    const orphans = async () => Promise.all((await listOrphanIds(host)).map(async (id): Promise<OrphanRow> => ({ id, summary: await orphanSummary(host, id) })));

    const onChange = (cb: (change: AppsChange) => void) => {
        let known = new Set(Object.keys(configured()));

        const onLifecycle = (app: InstanceInfo, state: string) => {
            if (state === 'stopped' && !(app.id in configured())) {
                cb({ type: 'removed', id: app.id });
                cb({ type: 'orphans' });
            } else {
                cb({ type: 'app', row: instanceRow(app, host) });
            }
        };
        const offLifecycle = onAppLifecycle(host, undefined, onLifecycle);

        const onOverride = (id: string) => {
            const row = hypervisorAppRow(host, id);
            if (row) cb({ type: 'app', row });
        };
        host.on('app_override_changed', onOverride);

        const offConfig = host.watchConfigEntry('apps', () => {
            const current = new Set(Object.keys(configured()));
            const live = new Set(host.listApplications().map(a => a.id));
            const rows = list();
            for (const id of current) cb({ type: 'app', row: rows.find(r => r.id === id) });
            // Still-running removed apps are dropped on their `stopped` event instead
            for (const id of known) if (!current.has(id) && !live.has(id)) cb({ type: 'removed', id });
            cb({ type: 'orphans' });
            known = current;
        });

        const onOrphansChanged = () => cb({ type: 'orphans' });
        host.on('orphans_changed', onOrphansChanged);

        // Entities register/unregister independently of lifecycle events
        const onEntities = (app: ApplicationInstance) => cb({ type: 'app', row: instanceRow(app, host) });
        const offEntities = observeEntityEvents(host, onEntities);

        return () => {
            offEntities();
            offLifecycle();
            host.off('app_override_changed', onOverride);
            host.off('orphans_changed', onOrphansChanged);
            offConfig();
        };
    };

    return { list, orphans, onChange };
}
