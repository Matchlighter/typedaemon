import { decodeGraph, encodeGraph } from "./graph_json";

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
});
