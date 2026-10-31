import type { AppDetailSource } from "./app_topic";
import { appResumableCounts, appScriptSummary, observeAppResumables } from "./hypervisor_app_resumables_source";
import { appHttpCounts, observeAppHttp } from "./hypervisor_app_http_source";
import { appNextSchedule, appScheduleCounts, observeAppSchedules } from "./hypervisor_app_schedules_source";
import { appEntityCounts, observeEntityEvents } from "./hypervisor_app_entities_source";
import { appStorageCounts, appStorageSummary, observeAppStorage } from "./hypervisor_app_storage_source";
import { onAppLifecycle, onDistinct } from "./follow_app";
import { hypervisorAppRow, type AppsHost } from "./hypervisor_apps_source";
import type { AppDetail } from "./protocol";
import { readCodeFrame } from "./code_frame";
import { parseStackFrames } from "./stack_frames";
import * as path from "path";

export function hypervisorAppDetailSource(host: AppsHost): AppDetailSource {
    const get = (id: string): AppDetail | undefined => {
        const row = hypervisorAppRow(host, id);
        if (!row) return undefined;

        const live = host.getApplication(id);
        const options = live?.options ?? host.currentConfig.apps?.[id];
        const wd = host.working_directory;

        const detail: AppDetail = {
            row,
            uuid: options.uuid || id,
            instanceOf: `${path.relative(wd, path.resolve(wd, options.source))}#${options.export || 'default'}`,
            logLevel: options.logging?.level,
            packages: { ...(options.dependencies || {}) },
            watching: !!options.watch?.source,
            counts: {},
        };
        Object.assign(
            detail.counts,
            live && appEntityCounts(host, live),
            live && appStorageCounts(live),
            live && appResumableCounts(live),
            live && appScheduleCounts(live),
            appHttpCounts(host, id),
        );
        if (live) {
            const nextSchedule = appNextSchedule(live), storage = appStorageSummary(live);
            detail.summary = {
                ...(nextSchedule && { nextSchedule }),
                ...(storage && { storage }),
                scripts: appScriptSummary(live),
                dependsOn: [...live.usedPlugins],
            };
        }
        if (live?.lastError) {
            const frames = parseStackFrames(live.lastError.stack || [], wd);
            // First frame in the user's tree (not node internals / dependencies)
            const own = frames.find(f => !path.isAbsolute(f.file) && !f.file.startsWith('node:') && !f.file.split('/').includes('node_modules'));
            detail.failure = { message: live.lastError.message, phase: live.lastError.phase, frames };
            if (live.lastError.logId !== undefined) detail.failure.logId = live.lastError.logId;
            const codeFrame = own && readCodeFrame(own, wd);
            if (codeFrame) detail.failure.codeFrame = codeFrame;
        }
        return detail;
    };

    const onChange = (id: string, cb: () => void) => {
        // Rows only change on these; not through a full apps subscription (it would build every app's row per event)
        const rowChanged = onDistinct(() => hypervisorAppRow(host, id), cb);
        const onLifecycle = (app: { id: string }) => { if (app.id === id) rowChanged() };
        const onOverride = (changed: string) => { if (changed === id) rowChanged() };
        const offLifecycle = onAppLifecycle(host, id, rowChanged);
        host.on('app_override_changed', onOverride);
        const offConfig = host.watchConfigEntry('apps', onDistinct(() => host.currentConfig.apps?.[id], cb));
        const offEntities = observeEntityEvents(host, onLifecycle);

        // Storage writes, resumables and schedules change far more often than anything else here: only a changed count matters
        const live = () => host.getApplication(id);
        const offStorage = observeAppStorage(host, id, onDistinct(() => [appStorageCounts(live())?.storage, appStorageSummary(live())], cb));
        const offResumables = observeAppResumables(host, id, onDistinct(() => { const app = live(); return app && [appResumableCounts(app), appScriptSummary(app)] }, cb));
        const offSchedules = observeAppSchedules(host, id, onDistinct(() => { const app = live(); return app && [appScheduleCounts(app).schedules, appNextSchedule(app)] }, cb));
        const offHttp = observeAppHttp(host, id, onDistinct(() => appHttpCounts(host, id)?.http, cb));
        return () => {
            offLifecycle();
            host.off('app_override_changed', onOverride);
            offConfig(); offEntities(); offStorage(); offResumables(); offSchedules(); offHttp();
        };
    };

    return { get, onChange };
}
