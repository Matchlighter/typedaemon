import type { CrossCallRow } from '@protocol';

/** An unfinished call whose target will not pick it up (or finish it): dead, or no longer an app */
export const isStuck = (c: CrossCallRow): boolean =>
    (c.status === 'pending' || c.status === 'started' || c.status === 'returning') && (c.targetState === undefined || c.targetState === 'dead');

/** Stuck calls first, then oldest first (undated last) */
export function sortCalls(rows: CrossCallRow[]): CrossCallRow[] {
    return [...rows].sort((a, b) =>
        Number(isStuck(b)) - Number(isStuck(a)) || (a.since ?? Infinity) - (b.since ?? Infinity) || 0);
}

/** Calls waiting on `appId` to run them */
export const blockedOn = (rows: CrossCallRow[], appId: string): CrossCallRow[] =>
    rows.filter(c => c.target === appId && c.status === 'pending');
