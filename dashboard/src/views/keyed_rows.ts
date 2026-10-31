import type { KeyedDelta } from '@protocol';
/** Fold a `{ upsert, remove }` delta into rows identified by `keyOf` (their `key` unless said otherwise): upserts replace in place or append, removals drop. */
export function applyKeyedDelta<R extends { key: string }>(rows: R[], d: KeyedDelta<R>): R[];
export function applyKeyedDelta<R>(rows: R[], d: KeyedDelta<R>, keyOf: (r: R) => string): R[];
export function applyKeyedDelta<R>(rows: R[], d: KeyedDelta<R>, keyOf: (r: R) => string = r => (r as { key: string }).key): R[] {
    if (d.remove?.length) rows = rows.filter(r => !d.remove!.includes(keyOf(r)));
    if (d.upsert?.length) {
        const byKey = new Map(d.upsert.map(r => [keyOf(r), r]));
        rows = rows.map(r => byKey.get(keyOf(r)) ?? r);
        const have = new Set(rows.map(keyOf));
        rows = [...rows, ...d.upsert.filter(r => !have.has(keyOf(r)))];
    }
    return rows;
}

/** Keys that are registration numbers: this order does not change when a row is updated (e.g. a schedule fires) */
export const inRegistrationOrder = <R extends { key: string }>(rows: R[]) => [...rows].sort((a, b) => Number(a.key) - Number(b.key));
