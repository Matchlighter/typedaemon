import deepEqual from "deep-eql";

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Dotted paths of the deepest plain-object entries that differ between `a` and `b` (arrays and other values are compared whole). Empty when equal. */
export function changedPaths(a: unknown, b: unknown, prefix = ''): string[] {
    if (isPlain(a) && isPlain(b)) {
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
        return keys.flatMap(k => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
    }
    return deepEqual(a, b) ? [] : prefix ? [prefix] : [];
}
