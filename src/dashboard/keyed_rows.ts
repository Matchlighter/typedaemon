import { isDeepStrictEqual } from "util";

import type { KeyedDelta } from "./protocol";

/** What changed between the previous rows (by key) and the next ones; undefined if nothing */
export function diffKeyedRows<R extends { key: string }>(prev: Map<string, R>, next: R[]): KeyedDelta<R> | undefined;
/** Same, for rows identified by something other than `key` */
export function diffKeyedRows<R>(prev: Map<string, R>, next: R[], keyOf: (r: R) => string): KeyedDelta<R> | undefined;
export function diffKeyedRows<R>(prev: Map<string, R>, next: R[], keyOf: (r: R) => string = r => (r as any).key): KeyedDelta<R> | undefined {
    const upsert = next.filter(r => !isDeepStrictEqual(prev.get(keyOf(r)), r));
    const keys = new Set(next.map(keyOf));
    const remove = [...prev.keys()].filter(k => !keys.has(k));
    if (!upsert.length && !remove.length) return undefined;
    return { ...(upsert.length && { upsert }), ...(remove.length && { remove }) };
}
