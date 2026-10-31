import type { AppStorageDelta, AppStorageSnapshot, StorageRow } from '@protocol';
import { lazy } from '../components/json_model';
import { applyKeyedDelta } from './keyed_rows';

/** Fold an `appStorage` topic delta into the snapshot */
export const applyStorageDelta = (cur: AppStorageSnapshot, d: AppStorageDelta): AppStorageSnapshot =>
    ({ ...cur, rows: applyKeyedDelta(cur.rows, d) });

/** The value to show: the real one, or a placeholder the JSON viewer fetches on expand */
export const rowValue = (r: StorageRow): unknown => r.lazy ? lazy(r.lazy) : r.value;

/** Rows to list, sorted by key so they don't jump while values change; `internal` counts the internal rows in the store; `filter` is a case-insensitive key substring */
export function visibleStorageRows(rows: StorageRow[], showInternal: boolean, filter = '') {
    const internal = rows.filter(r => r.internal).length;
    const needle = filter.trim().toLowerCase();
    return {
        rows: rows.filter(r => (showInternal || !r.internal) && r.key.toLowerCase().includes(needle)).sort((a, b) => a.key.localeCompare(b.key)),
        internal,
    };
}
