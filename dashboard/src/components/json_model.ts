/** Pure helpers for the JSON viewer (no React). */

export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export interface NodeMeta { kind: 'object' | 'array'; count: number; size: number }
export interface JsonDescription { kind: JsonKind; count: number; size: number; lazy: boolean }

export const STRING_LIMIT = 120;

const LAZY = Symbol.for('td.json.lazy');
export interface LazyValue { [LAZY]: true; meta: NodeMeta }

/** Placeholder for a subtree the server hasn't sent; the viewer fetches it through its `loader` on expand. */
export const lazy = (meta: NodeMeta): LazyValue => ({ [LAZY]: true, meta });
export const isLazy = (v: unknown): v is LazyValue => typeof v === 'object' && v !== null && (v as any)[LAZY] === true;

const encoder = new TextEncoder();
export const byteSize = (v: unknown) => encoder.encode(JSON.stringify(v) ?? '').length;

export function describeValue(v: unknown): JsonDescription {
    if (isLazy(v)) return { ...v.meta, lazy: true };
    if (Array.isArray(v)) return { kind: 'array', count: v.length, size: byteSize(v), lazy: false };
    if (v === null || v === undefined) return { kind: 'null', count: 0, size: 4, lazy: false };
    if (typeof v === 'object') return { kind: 'object', count: Object.keys(v).length, size: byteSize(v), lazy: false };
    return { kind: typeof v as 'string' | 'number' | 'boolean', count: 0, size: 0, lazy: false };
}

export function truncateString(s: string, limit = STRING_LIMIT) {
    return s.length > limit ? { text: s.slice(0, limit), truncated: true } : { text: s, truncated: false };
}

const isContainer = (v: unknown) => typeof v === 'object' && v !== null;

/**
 * One-line compact JSON of a scalar, or of an array/object whose members are all scalars, cut to ~`budget` chars with `… N more`.
 * `null` when it needs a tree: lazy placeholders and containers nested in containers.
 */
export function inlinePreview(v: unknown, budget = 60): string | null {
    if (isLazy(v)) return null;
    if (!isContainer(v)) return JSON.stringify(v) ?? 'null';
    const isArr = Array.isArray(v);
    if ((isArr ? (v as unknown[]) : Object.values(v as object)).some(isContainer)) return null;
    const parts = isArr
        ? (v as unknown[]).map(x => JSON.stringify(x) ?? 'null')
        : Object.entries(v as object).map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x) ?? 'null'}`);
    let used = 0, shown = 0;
    while (shown < parts.length && (shown === 0 || used + parts[shown].length + 1 <= budget)) used += parts[shown++].length + 1;
    const more = parts.length - shown;
    return (isArr ? '[' : '{') + parts.slice(0, shown).join(',') + (more > 0 ? `, … ${more} more` : '') + (isArr ? ']' : '}');
}

/** Stable key for UI state: `$`, `$.a`, `$.a[0]`, `$["odd key"]`. */
export function childPath(parent: string, key: string | number): string {
    if (typeof key === 'number') return `${parent}[${key}]`;
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
