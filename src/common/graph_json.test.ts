import { decodeGraph, encodeGraph, findUnencodable } from "./graph_json";

/** Round-trip through actual JSON, as persisted */
const roundTrip = (value: any) => decodeGraph(JSON.parse(JSON.stringify(encodeGraph(value))));

describe("encodeGraph/decodeGraph", () => {
    it.each([
        ["primitives", [1, "s", true, null]],
        ["a bare primitive", 3],
        ["null", null],
        ["nested data", { a: 1, b: { c: [1, null, { d: "x" }] } }],
        ["objects that look like references", { "@": 0, x: [{ "@": 5 }] }],
    ])("round-trips %s", (_, value) => {
        expect(roundTrip(value)).toEqual(value);
    });

    it("drops undefined like JSON", () => {
        expect(roundTrip({ a: undefined, b: [undefined] })).toEqual({ b: [null] });
    });

    it("preserves shared references", () => {
        const r = [1];
        const out = roundTrip({ state: { r }, temps: { t0: r } });
        expect(out.state.r).toBe(out.temps.t0);
        out.temps.t0.push(2);
        expect(out.state.r).toEqual([1, 2]);
    });

    it("preserves cycles", () => {
        const o: any = { list: [] };
        o.self = o;
        o.list.push(o);
        const out = roundTrip(o);
        expect(out.self).toBe(out);
        expect(out.list[0]).toBe(out);
    });

    it("keeps an Error as a plain Error with its name, message and stack, preserving identity", () => {
        const e = new TypeError("boom");
        const out = roundTrip({ e, again: [e] });
        expect(out.e).toBeInstanceOf(Error);
        expect([out.e.name, out.e.message, out.e.stack]).toEqual(["TypeError", "boom", e.stack]);
        expect(out.again[0]).toBe(out.e);
    });
});

describe("findUnencodable", () => {
    it("accepts plain data, cycles and Errors", () => {
        const o: any = { e: new Error("x") };
        o.self = o;
        expect(findUnencodable(o)).toBeUndefined();
    });

    it("names the path and kind of the first value it can't encode", () => {
        expect(findUnencodable({ state: { fs: [1, function f() { }] } })).toEqual({ path: "state.fs[1]", what: "a function (f)" });
        expect(findUnencodable({ "a b": new Map() }, "frame")).toEqual({ path: 'frame["a b"]', what: "a Map instance" });
    });
});
