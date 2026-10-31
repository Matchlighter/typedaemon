import { compareIds } from './by_id';
import { applyKeyedDelta } from './keyed_rows';
import type { PluginRow, PluginsDelta, PluginsSnapshot } from '@protocol';
import type { BadgeState } from '../components/StateBadge';

/** Fold a `plugins` topic delta into the snapshot */
export const applyPluginsDelta = (cur: PluginsSnapshot, d: PluginsDelta): PluginsSnapshot =>
    ({ plugins: applyKeyedDelta(cur.plugins, d, r => r.id) });

/** The connection while the plugin is up; otherwise (not yet up, shutting down...) the lifecycle state */
export function pluginBadge(r: Pick<PluginRow, 'state' | 'connection'>): BadgeState {
    if (r.state === 'started' && r.connection) return { kind: 'plugin', state: r.connection };
    return { kind: 'app', state: r.state };
}

/** By id so rows don't jump while states change */
export const sortPlugins = (rows: PluginRow[]): PluginRow[] =>
    [...rows].sort(compareIds);

/**
 * Ids of the plugins whose link is down (`reconnecting`/`disconnected`, or not running): what they serve (entity state...) is last-known only.
 * Unknown plugins (snapshot not in yet, or not listed) are not stale.
 */
export function downPlugins(snap: PluginsSnapshot | undefined): Set<string> {
    const out = new Set<string>();
    for (const p of snap?.plugins ?? []) {
        if (p.state !== 'started' || p.connection === 'reconnecting' || p.connection === 'disconnected') out.add(p.id);
    }
    return out;
}
