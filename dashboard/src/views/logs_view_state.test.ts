import type { LogRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { LogsViewState, logsViewState } from './logs_view_state';

const row = (id: number, over: Partial<LogRow> = {}): LogRow => ({ id, ts: id, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: `m${id}`, ...over });
const ids = (rows: LogRow[]) => rows.map(r => r.id);
const rows = [row(1), row(2, { level: 'error', channel: 'manager' }), row(3)];

describe('LogsViewState', () => {
    it('starts following the tail with nothing filtered', () => {
        const s = new LogsViewState();
        expect(s.paused).toBe(false);
        expect(ids(s.visible(rows))).toEqual([1, 2, 3]);
    });

    it('applies filters and search to what is shown', () => {
        const s = new LogsViewState();
        s.setChannel('manager');
        expect(ids(s.visible(rows))).toEqual([2]);
        s.setChannel('both');
        s.setSearch('m3');
        expect(ids(s.visible(rows))).toEqual([3]);
    });

    it('toggles levels', () => {
        const s = new LogsViewState();
        s.setLevels(['error']);
        expect(ids(s.visible(rows))).toEqual([2]);
    });

    it('pause holds the view: lines that arrive meanwhile are counted, not shown', () => {
        const s = new LogsViewState();
        s.pause(rows);
        const more = [...rows, row(4), row(5)];
        expect(s.paused).toBe(true);
        expect(ids(s.visible(more))).toEqual([1, 2, 3]);
        expect(s.pendingCount(more)).toBe(2);
    });

    it('pending count respects the filters', () => {
        const s = new LogsViewState();
        s.pause(rows);
        s.setChannel('manager');
        expect(s.pendingCount([...rows, row(4), row(5, { channel: 'manager' })])).toBe(1);
    });

    it('resume shows everything again', () => {
        const s = new LogsViewState();
        s.pause(rows);
        s.resume();
        expect(s.paused).toBe(false);
        expect(ids(s.visible([...rows, row(4)]))).toEqual([1, 2, 3, 4]);
    });

    it('keeps which stacks are open by line id', () => {
        const s = new LogsViewState();
        s.setExpanded(2, true);
        expect(s.isExpanded(2)).toBe(true);
        s.setExpanded(2, false);
        expect(s.isExpanded(2)).toBe(false);
    });

    describe('jump to error', () => {
        it('focuses the newest error, opens its stack and holds the view there (paused)', () => {
            const s = new LogsViewState();
            const all = [row(1, { level: 'error' }), row(2), row(3, { level: 'error' }), row(4)];
            expect(s.jumpToLastError(all)).toBe(true);
            expect(s.focusId).toBe(3);
            expect(s.isExpanded(3)).toBe(true);
            expect(s.paused).toBe(true);
            expect(ids(s.visible([...all, row(5)]))).toEqual([1, 2, 3, 4]);
        });

        it('shows the error even if the filters were hiding it (widening only what hid it)', () => {
            const s = new LogsViewState();
            s.setLevels(['info']);
            s.setChannel('manager');
            s.setSearch('zzz');
            const all = [row(1), row(2, { level: 'error', channel: 'user', message: 'boom' })];
            s.jumpToLastError(all);
            expect(ids(s.visible(all))).toEqual([1, 2]);
        });

        it('keeps filters that already let the error through', () => {
            const s = new LogsViewState();
            s.setLevels(['error', 'warn']);
            s.setSearch('boom');
            s.jumpToLastError([row(1, { level: 'error', message: 'boom' })]);
            expect(s.levels).toEqual(['error', 'warn']);
            expect(s.search).toBe('boom');
        });

        it('jumpToLog targets the given line, not the newest error', () => {
            const s = new LogsViewState();
            const all = [row(1, { level: 'error' }), row(2), row(3, { level: 'error' })];
            expect(s.jumpToLog(all, 1)).toBe(true);
            expect(s.focusId).toBe(1);
            expect(s.isExpanded(1)).toBe(true);
            expect(s.paused).toBe(true);
        });

        it('jumpToLog does nothing when the line is not (or no longer) in the rows', () => {
            const s = new LogsViewState();
            expect(s.jumpToLog([row(5, { level: 'error' })], 1)).toBe(false);
            expect(s.focusId).toBeUndefined();
            expect(s.paused).toBe(false);
        });

        it('does nothing without an error', () => {
            const s = new LogsViewState();
            expect(s.jumpToLastError(rows.filter(r => r.level !== 'error'))).toBe(false);
            expect(s.focusId).toBeUndefined();
            expect(s.paused).toBe(false);
        });
    });
});

describe('logsViewState (per view key)', () => {
    it('hands back the same state for the same key, so filters survive leaving the tab', () => {
        expect(logsViewState('app:a')).toBe(logsViewState('app:a'));
        expect(logsViewState('app:a')).not.toBe(logsViewState('app:b'));
    });
});

describe('LogsViewState: source kinds', () => {
    const mixed = [row(1), row(2, { source: { kind: 'plugin', id: 'ha' } }), row(3, { source: { kind: 'system', id: 'hypervisor' } })];
    it('shows all kinds, then only the chosen ones', () => {
        const s = new LogsViewState();
        expect(ids(s.visible(mixed))).toEqual([1, 2, 3]);
        s.setKinds(['plugin']);
        expect(ids(s.visible(mixed))).toEqual([2]);
    });
    it('jump to error widens a kind filter that hid the error', () => {
        const s = new LogsViewState();
        const rs = [row(1, { level: 'error', source: { kind: 'plugin', id: 'ha' } })];
        s.setKinds(['app']);
        expect(s.jumpToLastError(rs)).toBe(true);
        expect(ids(s.visible(rs))).toEqual([1]);
    });
});
