import { applyKeyedDelta } from './keyed_rows';
import type { AppRow, AppsDelta, AppsSnapshot } from '@protocol';

export type AppSegment = 'all' | 'running' | 'dead' | 'stopped';
export const APP_SEGMENTS: AppSegment[] = ['all', 'running', 'dead', 'stopped'];

/** Fold an `apps` topic delta into the snapshot */
export const applyAppsDelta = (cur: AppsSnapshot, d: AppsDelta): AppsSnapshot =>
    ({ apps: applyKeyedDelta(cur.apps, d, r => r.id), orphans: d.orphans ?? cur.orphans });

/** In-flight states (compiling, starting, stopping...) count as running: they are on their way to/from it */
export const segmentOf = (r: AppRow): Exclude<AppSegment, 'all'> =>
    r.state === 'dead' ? 'dead' : r.state === 'stopped' ? 'stopped' : 'running';

export function segmentCounts(rows: AppRow[]): Record<AppSegment, number> {
    const out = { all: rows.length, running: 0, dead: 0, stopped: 0 };
    for (const r of rows) out[segmentOf(r)]++;
    return out;
}



/** Segment + text filter. Keeps the server's order (config order), so rows don't jump while states change */
export function filterApps(rows: AppRow[], segment: AppSegment, text: string): AppRow[] {
    const q = text.trim().toLowerCase();
    return rows
        .filter(r => segment === 'all' || segmentOf(r) === segment)
        .filter(r => !q || [r.id, r.name, r.source].some(s => s.toLowerCase().includes(q)))    ;
}
