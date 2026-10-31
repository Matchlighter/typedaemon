import type { StorageRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { isLazy } from '../components/json_model';
import { applyStorageDelta, rowValue, visibleStorageRows } from './storage_model';

const row = (key: string, over: Partial<StorageRow> = {}): StorageRow => ({ key, value: 1, size: 1, writtenAt: 1, internal: false, ...over });

describe('applyStorageDelta', () => {
    it('upserts and removes rows by key, keeping the store path', () => {
        const cur = { path: 'p', rows: [row('a'), row('b'), row('c')] };
        const next = applyStorageDelta(cur, { upsert: [row('b', { value: 2 }), row('d')], remove: ['c'] });
        expect(next).toEqual({ path: 'p', rows: [row('a'), row('b', { value: 2 }), row('d')] });
    });
});

describe('rowValue', () => {
    it('is the value, or a lazy placeholder of the sent shape', () => {
        expect(rowValue(row('a', { value: { x: 1 } }))).toEqual({ x: 1 });
        const v = rowValue(row('b', { value: undefined, lazy: { kind: 'array', count: 3, size: 99 } }));
        expect(isLazy(v)).toBe(true);
        expect((v as any).meta).toEqual({ kind: 'array', count: 3, size: 99 });
    });
});

describe('visibleStorageRows', () => {
    const rows = [row('zeta'), row('_destroyers', { internal: true }), row('alpha'), row('ha[x]', { internal: true })];
    it('sorts by key and counts hidden internal rows', () => {
        expect(visibleStorageRows(rows, false)).toEqual({ rows: [rows[2], rows[0]], internal: 2 });
    });
    it('lists internal rows too when asked', () => {
        expect(visibleStorageRows(rows, true).rows.map(r => r.key)).toEqual(['_destroyers', 'alpha', 'ha[x]', 'zeta']);
    });
    it('filters by key substring, case-insensitively; internal still counted', () => {
        expect(visibleStorageRows(rows, true, 'ALP').rows.map(r => r.key)).toEqual(['alpha']);
        expect(visibleStorageRows(rows, false, 'destroy')).toEqual({ rows: [], internal: 2 });
    });
});
