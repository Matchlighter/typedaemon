import type { AppResumablesDelta, AppResumablesSnapshot, ResumableRow, ScriptRow } from '@protocol';
import { applyKeyedDelta } from './keyed_rows';

/** Fold an `appResumables` topic delta into the snapshot */
export const applyResumablesDelta = (cur: AppResumablesSnapshot, d: AppResumablesDelta): AppResumablesSnapshot => ({
    resumables: d.resumables ? applyKeyedDelta(cur.resumables, d.resumables) : cur.resumables,
    scripts: d.scripts ? applyKeyedDelta(cur.scripts, d.scripts) : cur.scripts,
});

export const GROUPS: { status: ResumableRow['status']; title: string }[] = [
    { status: 'running', title: 'Running' },
    { status: 'suspended', title: 'Suspended' },
    { status: 'failed', title: 'Failed to resume' },
];

/** Non-empty groups in display order; oldest call first so cards don't jump when new ones arrive */
export function groupResumables(rows: ResumableRow[]) {
    return GROUPS
        .map(g => ({ ...g, rows: rows.filter(r => r.status === g.status).sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key)) }))
        .filter(g => g.rows.length > 0);
}

/** "2 / 5": runs running against the limit */
export const limitLabel = (s: ScriptRow) => `${s.running} / ${s.limit ?? '∞'}`;

/** `evening("dusk", 3)` */
export const runsLabel = (script: string, params: unknown[]) => `${script}(${params.map(p => JSON.stringify(p)).join(', ')})`;
