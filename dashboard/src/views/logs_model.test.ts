import type { LogRow, LogsSnapshot } from '@protocol';
import { describe, expect, it } from 'vitest';
import { ALL_LEVELS, applyLogsDelta, causeIdAt, filterLogs, lastError, toLogEntry, type LogFilters } from './logs_model';

const row = (id: number, over: Partial<LogRow> = {}): LogRow => ({ id, ts: id * 1000, level: 'info', source: { kind: 'app', id: 'lights' }, channel: 'user', message: `m${id}`, ...over });
const ids = (rows: LogRow[]) => rows.map(r => r.id);
const open: LogFilters = { channel: 'both', levels: ALL_LEVELS, search: '' };

describe('applyLogsDelta', () => {
    const snap = (...rs: LogRow[]): LogsSnapshot => ({ entries: rs });

    it('appends new lines in order', () => {
        expect(ids(applyLogsDelta(snap(row(1)), { append: [row(2), row(3)] }, 100).entries)).toEqual([1, 2, 3]);
    });

    it('ignores lines the snapshot already has (the server may repeat them)', () => {
        expect(ids(applyLogsDelta(snap(row(1), row(2)), { append: [row(2), row(3)] }, 100).entries)).toEqual([1, 2, 3]);
    });

    it('keeps only the newest `cap` lines', () => {
        expect(ids(applyLogsDelta(snap(row(1), row(2), row(3)), { append: [row(4), row(5)] }, 3).entries)).toEqual([3, 4, 5]);
    });

    it('returns the same snapshot when nothing is new', () => {
        const s = snap(row(1));
        expect(applyLogsDelta(s, { append: [row(1)] }, 10)).toBe(s);
    });

    it('does not mutate the previous snapshot (observers compare by reference)', () => {
        const s = snap(row(1));
        applyLogsDelta(s, { append: [row(2)] }, 10);
        expect(ids(s.entries)).toEqual([1]);
    });
});

describe('filterLogs', () => {
    const rows = [
        row(1, { channel: 'user', level: 'info', message: 'Light turned ON' }),
        row(2, { channel: 'manager', level: 'lifecycle', message: 'Started' }),
        row(3, { channel: 'user', level: 'error', message: 'boom', source: { kind: 'plugin', id: 'mqtt' } }),
        row(4, { channel: 'user', level: 'debug', message: 'tick' }),
    ];

    it('passes everything through with open filters', () => {
        expect(ids(filterLogs(rows, open))).toEqual([1, 2, 3, 4]);
    });

    it('filters by channel (both = no filter)', () => {
        expect(ids(filterLogs(rows, { ...open, channel: 'manager' }))).toEqual([2]);
        expect(ids(filterLogs(rows, { ...open, channel: 'user' }))).toEqual([1, 3, 4]);
    });

    it('filters by the enabled levels', () => {
        expect(ids(filterLogs(rows, { ...open, levels: ['error', 'lifecycle'] }))).toEqual([2, 3]);
        expect(filterLogs(rows, { ...open, levels: [] })).toEqual([]);
    });

    it('searches message and source, ignoring case and surrounding space', () => {
        expect(ids(filterLogs(rows, { ...open, search: ' TURNED ' }))).toEqual([1]);
        expect(ids(filterLogs(rows, { ...open, search: 'MQTT' }))).toEqual([3]);
    });

    it('searches stack frames too, so a file name finds its errors', () => {
        const withStack = row(5, { level: 'error', stack: [{ file: 'apps/lights/util.ts', line: 3 }] });
        expect(ids(filterLogs([...rows, withStack], { ...open, search: 'util.ts' }))).toEqual([5]);
    });

    it('/regex/ search; invalid regex falls back to substring', () => {
        const rs = [row(1, { message: 'lamp on' }), row(2, { message: 'fan off' }), row(3, { message: 'a/(b' })];
        expect(ids(filterLogs(rs, { ...open, search: '/^LAMP|fan/' }))).toEqual([1, 2]);
        expect(ids(filterLogs(rs, { ...open, search: '/^LAMP/' }))).toEqual([1]);
        expect(ids(filterLogs(rs, { ...open, search: '/^LAMP/u' }))).toEqual([]);
        expect(ids(filterLogs(rs, { ...open, search: '/(b/' }))).toEqual([]);
        expect(ids(filterLogs(rs, { ...open, search: 'a/(b' }))).toEqual([3]);
    });

    it('combines filters', () => {
        expect(ids(filterLogs(rows, { channel: 'user', levels: ['info', 'error'], search: 'o' }))).toEqual([1, 3]);
    });
});

describe('lastError', () => {
    it('is the newest error line, if any', () => {
        expect(lastError([row(1, { level: 'error' }), row(2), row(3, { level: 'error' }), row(4)])?.id).toBe(3);
        expect(lastError([row(1)])).toBeUndefined();
    });
});

describe('toLogEntry (for LogLine)', () => {
    it('labels the source, marking TypeDaemon\'s own lines about an app', () => {
        expect(toLogEntry(row(1)).source).toBe('app:lights');
        expect(toLogEntry(row(1, { channel: 'manager' })).source).toBe('app:lights (td)');
        expect(toLogEntry(row(1, { source: { kind: 'system', id: 'hypervisor' }, channel: 'manager' })).source).toBe('system');
        expect(toLogEntry(row(1, { source: { kind: 'plugin', id: 'mqtt' }, channel: 'user' })).source).toBe('plugin:mqtt');
    });

    it('carries ts, level, message and stack', () => {
        const stack = [{ file: 'a.ts', line: 1 }];
        expect(toLogEntry(row(1, { level: 'error', stack }))).toMatchObject({ ts: 1000, level: 'error', message: 'm1', stack });
    });
});

describe('filterLogs: source kinds', () => {
    const rs = [row(1), row(2, { source: { kind: 'plugin', id: 'ha' } }), row(3, { source: { kind: 'system', id: 'hypervisor' } })];
    it('shows every kind unless narrowed', () => {
        expect(ids(filterLogs(rs, open))).toEqual([1, 2, 3]);
    });
    it('keeps only the chosen kinds', () => {
        expect(ids(filterLogs(rs, { ...open, kinds: ['plugin', 'system'] }))).toEqual([2, 3]);
    });
});

describe('causeIdAt', () => {
    it('links a lifecycle line to the error just before it from the same source', () => {
        const rows = [row(1, { level: 'error' }), row(2, { level: 'lifecycle' }), row(3, { level: 'lifecycle' })];
        expect(causeIdAt(rows, 1)).toBe(1);
        expect(causeIdAt(rows, 2)).toBeUndefined();
        expect(causeIdAt(rows, 0)).toBeUndefined();
    });
});
