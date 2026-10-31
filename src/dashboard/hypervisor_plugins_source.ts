import type { Hypervisor } from "../hypervisor/hypervisor";
import type { PluginInstance } from "../hypervisor/plugin_instance";
import type { PluginRow } from "./protocol";
import type { PluginsSource } from "./plugins_topic";
import { redactConfig } from "./redact_config";

/** What the dashboard needs from the hypervisor (public API only) */
export type PluginsHost = Pick<Hypervisor, 'currentConfig' | 'listPlugins' | 'listApplications' | 'watchConfigEntry' | 'on' | 'off'>;

/** Reconnect a running plugin; throws if it is not running or cannot reconnect */
export async function reconnectPlugin(host: Pick<Hypervisor, 'listPlugins'>, id: string): Promise<void> {
    const plugin = host.listPlugins().find(p => p.id === id);
    if (!plugin) throw new Error(`No such plugin: ${id}`);
    if (plugin.state !== 'started' || !plugin.instance) throw new Error(`Plugin ${id} is not running (${plugin.state})`);
    await plugin.instance.reconnect();
}

/** `user:pass@` removed from URLs */
const stripCredentials = (target: string) => target.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');

type PluginInfo = Pick<PluginInstance, 'id' | 'options' | 'state' | 'stateSince' | 'instance'>;

function row(id: string, config: any, live: PluginInfo | undefined, usedBy: string[]): PluginRow {
    const client = live?.instance;
    const out: PluginRow = {
        id,
        type: config?.type,
        state: live ? live.state : 'stopped',
        since: live ? live.stateSince : Date.now(),
        config: redactConfig(config ?? {}),
    };
    if (client?.connectionState) out.connection = client.connectionState;
    const target = client?.connectionTarget;
    if (target) out.target = stripCredentials(target);
    const level = config?.logging?.level;
    if (level) out.logLevel = level;
    if (client?.statusSummary) out.summary = client.statusSummary;
    if (usedBy.length) out.usedBy = usedBy;
    return out;
}

export function hypervisorPluginsSource(host: PluginsHost): PluginsSource {
    const list = (): PluginRow[] => {
        const users = new Map<string, string[]>();
        for (const app of host.listApplications()) {
            for (const pid of app.usedPlugins) users.set(pid, [...(users.get(pid) ?? []), app.id]);
        }
        const usedBy = (id: string) => (users.get(id) ?? []).sort();
        const live = new Map(host.listPlugins().map(p => [p.id, p as PluginInfo]));
        const rows = Object.entries(host.currentConfig.plugins || {}).map(([id, cfg]) => row(id, live.get(id)?.options ?? cfg, live.get(id), usedBy(id)));
        // Live but no longer configured: a just-removed plugin that is still shutting down
        for (const [id, p] of live) if (!(id in (host.currentConfig.plugins || {}))) rows.push(row(id, p.options, p, usedBy(id)));
        return rows;
    };

    const onChange = (cb: () => void) => {
        const offConnections = observePluginConnections(host, cb);
        const offConfig = host.watchConfigEntry('plugins', cb);
        // `usedBy` follows which apps are up and what they have asked for so far
        host.on('app_lifecycle', cb);
        return () => {
            host.off('app_lifecycle', cb);
            offConnections();
            offConfig();
        };
    };

    return { list, onChange };
}

/**
 * `cb` on every plugin lifecycle step and every connection change of any plugin instance. Connection changes come
 * from the instances themselves, so this (re)attaches as plugins come and go. Returns the unsubscribe
 */
export function observePluginConnections(host: Pick<Hypervisor, 'listPlugins' | 'on' | 'off'>, cb: () => void): () => void {
    const attached = new Map<object, () => void>();
    const sync = () => {
        const current = new Set<object>();
        for (const p of host.listPlugins()) {
            const events = p.instance?.connectionEvents;
            if (!events) continue;
            current.add(events);
            if (!attached.has(events)) {
                events.on('change', cb);
                attached.set(events, () => events.off('change', cb));
            }
        }
        for (const [events, off] of attached) if (!current.has(events)) { off(); attached.delete(events) }
    };
    const onLifecycle = () => { sync(); cb() };
    sync();
    host.on('plugin_lifecycle', onLifecycle);
    return () => {
        host.off('plugin_lifecycle', onLifecycle);
        attached.forEach(off => off());
        attached.clear();
    };
}
