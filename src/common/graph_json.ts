import { findUnserializable } from "./util";

/**
 * JSON-compatible encoding of a value graph that, unlike plain JSON, preserves object identity:
 * objects/arrays reachable more than once (shared references, cycles) decode as the same object.
 *
 * Every object/array is stored once in `objects`; wherever one appears (in `root` or inside an entry) it is
 * replaced by `{ "@": index }`. Since no real object is ever inline, any object in the encoding is such a reference.
 * Values must be plain data or Errors (see `findUnencodable`). An Error is kept as its `name`, `message` and `stack` and
 * decodes as a plain `Error` carrying them (its class and any other properties are not kept).
 *
 * Objects the caller persists out-of-band ("externals", eg. ResumablePromises) are stored as the JSON token their
 * `GraphExternals.encode` gives, and decoded by handing that token to `decodeGraph`'s `resolveExternal`.
 */
export interface EncodedGraph {
    root: any;
    objects: any[];
    /** Indices of `objects` that are Errors */
    errors?: number[];
    /** Indices of `objects` that are external tokens */
    externals?: number[];
}

export interface GraphExternals {
    is: (v: object) => boolean;
    /** JSON token standing for `v` */
    encode: (v: object) => any;
}

const REF = "@";

const isError = (v: any) => v instanceof Error;

/** The first part of `value` that `encodeGraph` can't encode (see `findUnserializable`) */
export function findUnencodable(value: any, root?: string, isExternal?: GraphExternals["is"]) {
    return findUnserializable(value, isExternal ? [isError, isExternal] : [isError], { cycles: true, root });
}

export function encodeGraph(value: any, externals?: GraphExternals): EncodedGraph {
    const objects: any[] = [];
    const errors: number[] = [];
    const externalIndices: number[] = [];
    const indices = new Map<object, number>();

    const encode = (v: any): any => {
        if (v === null || typeof v != "object") return v;

        let index = indices.get(v);
        if (index === undefined) {
            index = objects.length;
            indices.set(v, index);
            objects.push(null);
            if (externals?.is(v)) {
                externalIndices.push(index);
                objects[index] = externals.encode(v);
            } else if (isError(v)) {
                errors.push(index);
                objects[index] = { name: v.name, message: v.message, stack: v.stack };
            } else objects[index] = Array.isArray(v)
                ? v.map(encode)
                : Object.fromEntries(Object.entries(v).map(([k, iv]) => [k, encode(iv)]));
        }
        return { [REF]: index };
    };

    const root = encode(value);
    return {
        root, objects,
        ...(errors.length && { errors }),
        ...(externalIndices.length && { externals: externalIndices }),
    };
}

/** `resolveExternal` gives the object an external token (see `GraphExternals`) stands for; required if the graph has any */
export function decodeGraph(encoded: EncodedGraph, resolveExternal?: (token: any) => any): any {
    const errors = new Set(encoded.errors ?? []);
    const externals = new Set(encoded.externals ?? []);
    if (externals.size && !resolveExternal) throw new Error("Graph has externals, but no way to resolve them was given");
    const shells = encoded.objects.map((entry, i) => {
        if (externals.has(i)) return resolveExternal(entry);
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
        const index = v[REF];
        if (!(index in shells)) throw new Error(`Invalid graph reference: ${JSON.stringify(v)}`);
        return shells[index];
    };

    encoded.objects.forEach((entry, i) => {
        if (errors.has(i) || externals.has(i)) return;
        const shell = shells[i];
        if (Array.isArray(entry)) {
            entry.forEach((v, j) => shell[j] = decode(v));
        } else {
            for (const [k, v] of Object.entries(entry)) shell[k] = decode(v);
        }
    });

    return decode(encoded.root);
}
