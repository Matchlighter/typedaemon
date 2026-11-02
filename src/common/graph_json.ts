/**
 * JSON-compatible encoding of a value graph that, unlike plain JSON, preserves object identity:
 * objects/arrays reachable more than once (shared references, cycles) decode as the same object.
 *
 * Every object/array is stored once in `objects`; wherever one appears (in `root` or inside an entry) it is
 * replaced by `{ "@": index }`. Since no real object is ever inline, any object in the encoding is such a reference.
 * Values must be plain data (see `serializable(value, [], { cycles: true })`).
 */
export interface EncodedGraph {
    root: any;
    objects: any[];
}

const REF = "@";

export function encodeGraph(value: any): EncodedGraph {
    const objects: any[] = [];
    const indices = new Map<object, number>();

    const encode = (v: any): any => {
        if (v === null || typeof v != "object") return v;

        let index = indices.get(v);
        if (index === undefined) {
            index = objects.length;
            indices.set(v, index);
            objects.push(null);
            objects[index] = Array.isArray(v)
                ? v.map(encode)
                : Object.fromEntries(Object.entries(v).map(([k, iv]) => [k, encode(iv)]));
        }
        return { [REF]: index };
    };

    return { root: encode(value), objects };
}

export function decodeGraph(encoded: EncodedGraph): any {
    const shells = encoded.objects.map(entry => Array.isArray(entry) ? [] : {});

    const decode = (v: any): any => {
        if (v === null || typeof v != "object") return v;
        const shell = shells[v[REF]];
        if (!shell) throw new Error(`Invalid graph reference: ${JSON.stringify(v)}`);
        return shell;
    };

    encoded.objects.forEach((entry, i) => {
        const shell = shells[i];
        if (Array.isArray(entry)) {
            entry.forEach((v, j) => shell[j] = decode(v));
        } else {
            for (const [k, v] of Object.entries(entry)) shell[k] = decode(v);
        }
    });

    return decode(encoded.root);
}
