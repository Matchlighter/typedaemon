import type { AppSchedulesSource } from "./app_schedules_topic";
import { configuredAppIds, observeAllApps, type AllAppsHost } from "./observe_all_apps";
import type { GlobalScheduleRow } from "./protocol";
import type { SchedulesSource } from "./schedules_topic";

/** What the global schedules list needs from the hypervisor (public API only) */
export type SchedulesHost = AllAppsHost;

/** The schedules of every configured app (as on its own Schedules tab) as one list, live. */
export function hypervisorSchedulesSource(host: SchedulesHost, apps: AppSchedulesSource): SchedulesSource {
    return {
        list: () => configuredAppIds(host).flatMap(id => (apps.list(id) ?? []).map((r): GlobalScheduleRow => ({ ...r, key: `${id}/${r.key}`, app: id }))),
        onChange: cb => observeAllApps(host, (id, f) => apps.onChange(id, f), cb),
    };
}
