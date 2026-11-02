import { findUnserializable } from "./util";

/**
 * JSON-compatible encoding of a value graph that, unlike plain JSON, preserves object identity:
 * objects/arrays reachable more than once (shared references, cycles) decode as the same object.
 *
 * Every object/array is stored once in `objects`; wherever one appears (in `root` or inside an entry) it is
 * replaced by `{ "@": index }`. Since no real object is ever inline, any object in the encoding is such a reference.
 * Values must be plain data or Errors (see `findUnencodable`). An Error is kept as its `name`, `message` and `stack` and
 * decodes as a plain `Error` carrying them (its class and any other properties are not kept).
 */
export interface EncodedGraph {
    root: any;
    objects: any[];
    /** Indices of `objects` that are Errors */
    errors?: number[];
}

const REF = "@";

const isError = (v: any) => v instanceof Error;

/** The first part of `value` that `encodeGraph` can't encode (see `findUnserializable`) */
export function findUnencodable(value: any, root?: string) {
    return findUnserializable(value, [isError], { cycles: true, root });
}

export function encodeGraph(value: any): EncodedGraph {
    const objects: any[] = [];
    const errors: number[] = [];
    const indices = new Map<object, number>();

    const encode = (v: any): any => {
        if (v === null || typeof v != "object") return v;

        let index = indices.get(v);
        if (index === undefined) {
            index = objects.length;
            indices.set(v, index);
            objects.push(null);
            if (isError(v)) {
                errors.push(index);
                objects[index] = { name: v.name, message: v.message, stack: v.stack };
            } else objects[index] = Array.isArray(v)
                ? v.map(encode)
                : Object.fromEntries(Object.entries(v).map(([k, iv]) => [k, encode(iv)]));
        }
        return { [REF]: index };
    };

    const root = encode(value);
    return errors.length ? { root, objects, errors } : { root, objects };
}

export function decodeGraph(encoded: EncodedGraph): any {
    const errors = new Set(encoded.errors ?? []);
    const shells = encoded.objects.map((entry, i) => {
        if (errors.has(i)) {
            const error = new Error(entry.message);
            error.name = entry.name;
            error.stack = entry.stack;
            return error;
        }
        return Array.isArray(entry) ? [] : {};
    });

    const decode = (v: any): any => {
        if (v === null || typeof v != "object") return v;
        const shell = shells[v[REF]];
        if (!shell) throw new Error(`Invalid graph reference: ${JSON.stringify(v)}`);
        return shell;
    };

    encoded.objects.forEach((entry, i) => {
        if (errors.has(i)) return;
        const shell = shells[i];
        if (Array.isArray(entry)) {
            entry.forEach((v, j) => shell[j] = decode(v));
        } else {
            for (const [k, v] of Object.entries(entry)) shell[k] = decode(v);
        }
    });

    return decode(encoded.root);
}
