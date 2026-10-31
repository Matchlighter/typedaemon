import * as path from "path";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { storageRows } from "./hypervisor_app_storage_source";
import type { AppState, CrossCallRow } from "./protocol";
import type { SystemFacts, SystemSource } from "./system_topic";
import { onAppLifecycle } from "./follow_app";
import { hypervisorHaBaseUrl } from "./hypervisor_ha_base_url";
import { observePluginConnections } from "./hypervisor_plugins_source";
import { redactConfig } from "./redact_config";

/** What the dashboard needs from the hypervisor (public API only) */
export type SystemHost = Pick<Hypervisor, 'state' | 'configFile' | 'working_directory' | 'currentConfig' | 'sharedStorages' | 'crossCallStore' | 'listApplications' | 'listPlugins' | 'on' | 'off'>;

/** Call arguments as short JSON text; undefined when there are none */
function argsText(parameters: unknown[] | undefined): string | undefined {
    if (!parameters?.length) return undefined;
    let text: string;
    try { text = parameters.map(p => JSON.stringify(p) ?? 'undefined').join(', ') } catch { return '…' }
    return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

export function hypervisorSystemSource(host: SystemHost): SystemSource & { value(store: string, key: string): Promise<unknown>; cancelCall(uuid: string): void } {
    const store = (name: string) => {
        const s = host.sharedStorages.get(name);
        if (!s) throw new Error(`Unknown shared store: ${name}`);
        return s;
    };

    const crossCalls = (): CrossCallRow[] => {
        const states = new Map(host.listApplications().map(a => [a.id, a.state as AppState]));
        return host.crossCallStore.listCalls().map(c => {
            const row: CrossCallRow = { uuid: c.uuid, source: c.source_app, target: c.target_app, method: c.method, status: c.status };
            if (c.created_at != null) row.since = c.created_at;
            if (c.start_by != null) row.timeoutAt = c.start_by;
            const args = argsText(c.parameters);
            if (args) row.args = args;
            const targetState = states.get(c.target_app);
            if (targetState) row.targetState = targetState;
            return row;
        });
    };

    return {
        get(withStores): SystemFacts {
            const location = host.currentConfig.location;
            const snap: SystemFacts = { state: host.state, crossCalls: crossCalls() };
            if (withStores) {
                snap.stores = host.sharedStorages.list().sort().map(name => {
                    const file = host.sharedStorages.fileOf(name);
                    return { name, path: path.relative(host.working_directory, file), usedBy: host.sharedStorages.usedBy(name), rows: storageRows(store(name), file) };
                });
            }
            if (host.configFile) snap.configPath = host.configFile;
            const { plugins, apps, ...rest } = host.currentConfig;
            snap.resolvedConfig = redactConfig({ ...rest, plugins: Object.keys(plugins ?? {}), apps: Object.keys(apps ?? {}) }) as Record<string, unknown>;
            if (location) snap.location = { ...location };
            const haBaseUrl = hypervisorHaBaseUrl(host);
            if (haBaseUrl) snap.haBaseUrl = haBaseUrl;
            return snap;
        },

        onChange(cb) {
            const offCalls = host.crossCallStore.onChange(cb);
            host.sharedStorages.on('change', cb);
            const offLifecycle = onAppLifecycle(host, undefined, cb);
            // The HA plugin learns its base URL once connected
            const offPlugins = observePluginConnections(host, cb);
            return () => {
                offPlugins();
                offCalls();
                host.sharedStorages.off('change', cb);
                offLifecycle();
            };
        },

        cancelCall: uuid => host.crossCallStore.cancelCall(uuid),

        async value(name, key) {
            const s = store(name);
            if (s.getValue(key) == null) throw new Error(`No key '${key}'`);
            return s.getValue(key);
        },
    };
}
