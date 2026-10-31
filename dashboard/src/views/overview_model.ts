import type { AppRow, CrossCallRow, GlobalEntityRow, GlobalScheduleRow, LifecycleCause, LifecycleDelta, LifecycleEvent, LifecycleSnapshot, OrphanRow, PluginRow } from '@protocol';
import type { BadgeState } from '../components/StateBadge';
import { formatBytes, plural } from '../format';
import { appHref, pluginHref } from '../hrefs';
import { RouteStore } from '../stores/route_store';
import { segmentCounts } from './apps_model';
import { isStuck } from './system_model';

export interface OverviewInput {
    apps: AppRow[];
    orphans: OrphanRow[];
    plugins: PluginRow[];
    calls: CrossCallRow[];
}

export interface HealthSummary {
    /** `running` counts in-flight apps too; `started`/`starting` split it */
    apps: { total: number; running: number; dead: number; stopped: number; started: number; starting: number };
    plugins: { total: number; ok: number };
    orphans: number;
    failedResumes: number;
    /** Resumables across apps, failed ones included */
    resumables: number;
}

const IN_FLIGHT = new Set<AppRow['state']>(['initializing', 'compiling', 'starting']);

/** A plugin that is up and, if it has a link to the outside, linked */
const pluginOk = (p: PluginRow) => p.state === 'started' && p.connection !== 'disconnected' && p.connection !== 'reconnecting';

export function healthSummary({ apps, orphans, plugins }: OverviewInput): HealthSummary {
    const { all, running, dead, stopped } = segmentCounts(apps);
    return {
        apps: { total: all, running, dead, stopped, started: apps.filter(a => a.state === 'started').length, starting: apps.filter(a => IN_FLIGHT.has(a.state)).length },
        plugins: { total: plugins.length, ok: plugins.filter(pluginOk).length },
        orphans: orphans.length,
        failedResumes: apps.reduce((n, a) => n + (a.failedResumes ?? 0), 0),
        resumables: apps.reduce((n, a) => n + (a.resumables ?? 0), 0),
    };
}

export interface EntitySummary {
    total: number;
    linked: number;
    unlinked: number;
    /** Entities still in HA per orphaned app (id -> count): what a cleanup would remove */
    leftBehind: Record<string, number>;
}

export function entitySummary(rows: GlobalEntityRow[]): EntitySummary {
    const linked = rows.filter(r => r.linked).length;
    const leftBehind: Record<string, number> = {};
    for (const r of rows) if (r.orphan) leftBehind[r.app] = (leftBehind[r.app] ?? 0) + 1;
    return { total: rows.length, linked, unlinked: rows.length - linked, leftBehind };
}

export interface AttentionItem {
    key: string;
    severity: 'error' | 'warn';
    /** State badge at the row start */
    badge: BadgeState;
    /** Bold, links to `href` */
    subject: string;
    /** Sentence after the subject ("failed while starting"); `at` follows it as a relative time */
    text: string;
    at?: number;
    /** Second line: a mono error/identifier (`detailTone: 'error'`) or muted facts */
    detail?: string;
    detailTone?: 'error' | 'muted';
    /** The view/tab that fixes it */
    href: string;
    /** Label of the action button (links to `href`) */
    action: string;
}

type PluginProblem = Pick<AttentionItem, 'severity' | 'badge' | 'text'>;
function pluginProblem(p: PluginRow): PluginProblem | undefined {
    if (p.state === 'dead') return { severity: 'error', badge: { kind: 'app', state: 'dead' }, text: 'is dead' };
    if (p.state === 'stopped') return { severity: 'warn', badge: { kind: 'app', state: 'stopped' }, text: 'is stopped' };
    if (p.state !== 'started') return undefined;
    if (p.connection === 'disconnected') return { severity: 'error', badge: { kind: 'plugin', state: 'disconnected' }, text: 'is disconnected' };
    if (p.connection === 'reconnecting') return { severity: 'warn', badge: { kind: 'plugin', state: 'reconnecting' }, text: 'is reconnecting' };
}

function orphanDetail(o: OrphanRow): string {
    const s = o.summary;
    if (!s) return 'Clean up its leftovers';
    return [`${plural(s.entities, 'entity', 'entities')} still in HA`, `${plural(s.destroyers.length, 'pending destroyer')}`, `operating dir ${formatBytes(s.dirBytes)}`].join(' · ');
}

/** Everything that needs the operator, errors first; each links to where it is fixed */
export function attentionItems({ apps, orphans, plugins, calls }: OverviewInput): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const a of apps) {
        if (a.state === 'dead') {
            items.push({
                key: `app:${a.id}`, severity: 'error', badge: { kind: 'app', state: 'dead' }, subject: a.name,
                text: a.error ? `failed while ${a.error.phase}` : 'is dead', at: a.since,
                ...(a.error && { detail: a.error.message, detailTone: 'error' as const }),
                href: appHref(a.id), action: 'View error',
            });
        }
    }
    for (const p of plugins) {
        const problem = pluginProblem(p);
        if (problem) items.push({ key: `plugin:${p.id}`, ...problem, subject: p.id, ...(p.target && { detail: p.target, detailTone: 'muted' as const }), href: pluginHref(p.id), action: 'View plugin' });
    }
    for (const c of calls) {
        if (isStuck(c)) {
            items.push({
                key: `call:${c.uuid}`, severity: 'error', badge: { kind: 'call', state: 'pending' }, subject: 'Cross-app call stuck',
                text: `target app is ${c.targetState ?? 'missing'}`, detail: `${c.source} → ${c.target}.${c.method}()`, detailTone: 'error',
                href: RouteStore.href('/system'), action: 'View call',
            });
        }
    }
    for (const a of apps) {
        if (a.failedResumes) {
            const n = a.failedResumes;
            items.push({
                key: `resume:${a.id}`, severity: 'warn', badge: { kind: 'resumable', state: 'failed' }, subject: a.name,
                text: `has ${plural(n, 'resumable')} that failed to resume`, detail: 'Retried at every start until fixed or discarded', detailTone: 'muted',
                href: appHref(a.id, 'resumables'), action: 'View resumables',
            });
        }
    }
    for (const o of orphans) {
        items.push({
            key: `orphan:${o.id}`, severity: 'warn', badge: { kind: 'app', state: 'orphan' }, subject: o.id, text: 'removed from config',
            ...(o.summary && { at: o.summary.removedAt }), detail: orphanDetail(o), detailTone: 'muted',
            href: appHref(o.id), action: 'Review & clean up',
        });
    }
    // Stable sort: errors first, discovery order within a severity
    return items.sort((x, y) => Number(y.severity === 'error') - Number(x.severity === 'error'));
}

const FEED_LIMIT = 200;

/** Fold a `lifecycle` topic delta into the snapshot */
export const applyLifecycleDelta = (cur: LifecycleSnapshot, d: LifecycleDelta): LifecycleSnapshot =>
    ({ events: [...cur.events, ...d.append].slice(-FEED_LIMIT) });

const CAUSES: Record<LifecycleCause, string> = {
    manual: 'from the dashboard',
    source_change: 'after source change',
    config_change: 'after config change',
    plugin_started: 'after a plugin it needs started',
};
export const causeLabel = (c: LifecycleCause | undefined): string | undefined => c && CAUSES[c];

export interface FeedEntry {
    event: LifecycleEvent;
    /** The app's state before this event */
    from?: LifecycleEvent['from'];
    /** The transition in words: `compiling → starting`, `resumed preheat` */
    transition: string;
    /** State whose colour marks the line */
    tone: Extract<BadgeState, { kind: 'app' }>;
    /** What happened, in a sentence (the error of a death is shown on its own, so not here) */
    reason?: string;
}

const TRANSITIONAL = new Set<LifecycleEvent['state']>(['initializing', 'compiling', 'starting']);

function feedReason(event: LifecycleEvent): string | undefined {
    if (event.detail) return event.detail;
    const cause = causeLabel(event.cause);
    if (event.state === 'started') return cause ? `Restarted ${cause}` : 'Started';
    if (TRANSITIONAL.has(event.state)) return cause ? `Restarted ${cause}` : undefined;
    if (event.state === 'dead') return event.error ? undefined : 'Died';
    if (event.state === 'stopped') return 'Stopped';
}

/** Feed lines, newest first, each carrying the state its app was in before */
export function feedEntries(events: LifecycleEvent[]): FeedEntry[] {
    const out = events.map((event): FeedEntry => {
        const { from } = event;
        const reason = feedReason(event);
        const resumed = event.state === 'resumed';
        // A resumption is good news about a running app
        const state = event.state === 'resumed' ? 'started' : event.state;
        return {
            event,
            ...(from && { from }),
            transition: resumed ? `resumed ${(event.resumed ?? []).join(', ')}`.trim() : from ? `${from} → ${event.state}` : event.state,
            tone: { kind: 'app', state },
            ...(reason && { reason }),
        };
    });
    return out.reverse();
}

/** The next `limit` schedule fires across apps, soonest first (schedules with nothing pending are left out) */
export const upNext = (rows: GlobalScheduleRow[], limit = 4): GlobalScheduleRow[] =>
    rows.filter(r => r.nextAt != null).sort((a, b) => a.nextAt! - b.nextAt!).slice(0, limit);
