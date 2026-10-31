const ids = new WeakMap<object, number>();
let next = 1;

/** A number identifying `obj` for as long as it lives; never reused by another object in this process */
export function objectId(obj: object): number {
    let id = ids.get(obj);
    if (id === undefined) ids.set(obj, id = next++);
    return id;
}
