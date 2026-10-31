import type { AppResumablesSource } from "./app_resumables_topic";
import { configuredAppIds, observeAllApps, type AllAppsHost } from "./observe_all_apps";
import type { GlobalResumableRow } from "./protocol";
import type { ResumablesSource } from "./resumables_topic";

/** What the global resumables list needs from the hypervisor (public API only) */
export type ResumablesHost = AllAppsHost;

/** The resumables of every configured app (as on its own Resumables tab) as one list, live. */
export function hypervisorResumablesSource(host: ResumablesHost, apps: AppResumablesSource): ResumablesSource {
    return {
        list: () => configuredAppIds(host).flatMap(id => (apps.get(id)?.resumables ?? []).map((r): GlobalResumableRow => ({ ...r, key: `${id}/${r.key}`, app: id, resumableKey: r.key }))),
        onChange: cb => observeAllApps(host, (id, f) => apps.onChange(id, f), cb),
    };
}
