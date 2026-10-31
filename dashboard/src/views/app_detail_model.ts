import type { AppRow } from '@protocol';

export type AppAction = 'restart' | 'stop' | 'start';

/** Header actions available for the app's current state (in display order) */
export function actionsFor(row: AppRow, inFlight?: AppAction): AppAction[] {
    if (isRestarting(row, inFlight)) return ['restart', 'stop'];
    if (row.state === 'stopping') return [];
    if (row.state === 'stopped') return ['start'];
    return ['restart', 'stop'];
}

/**
 * A restart the dashboard asked for is still running and the app is between instances (old one stopping/stopped, new one not yet up):
 * views show it as restarting instead of flashing stopped + Start
 */
export const isRestarting = (row: AppRow, inFlight?: AppAction) =>
    inFlight === 'restart' && (row.state === 'stopping' || row.state === 'stopped' || isSettling(row.state));

/** Badge props for an app row (a restart in flight shows `restarting`) */
export function appBadge(row: AppRow, inFlight?: AppAction) {
    return isRestarting(row, inFlight)
        ? { kind: 'app' as const, state: 'starting' as const, label: 'restarting' }
        : { kind: 'app' as const, state: row.state, override: row.stoppedOverride };
}

/** Between instances (hot reload etc.): counts aren't known yet, so views show … rather than a misleading 0 / unlinked warning */
export const isSettling = (state: AppRow['state']) => state === 'initializing' || state === 'compiling' || state === 'starting';

/** The "stopped from the dashboard, resets on next config reload" notice */
export const showOverrideNotice = (row: AppRow) =>
    !!row.stoppedOverride && (row.state === 'stopped' || row.state === 'stopping');
