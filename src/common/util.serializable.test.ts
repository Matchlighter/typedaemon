import * as vm from "vm";

import { serializable } from "./util";

describe("serializable", () => {
    it.each([
        ["primitives", [1, "s", true, undefined]],
        ["null", null],
        ["plain objects", { a: 1, b: { c: [1, null] } }],
        ["null-prototype objects", Object.assign(Object.create(null), { a: 1 })],
        ["arrays", [1, [2, { a: 3 }]]],
        ["objects from another realm (eg. an app VM)", vm.runInNewContext(`({ a: [{ b: 1 }] })`)],
    ])("accepts %s", (_, value) => {
        expect(serializable(value, [])).toBe(true);
    });

    class Thing { }

    it.each([
        ["functions", () => 1],
        ["class instances", new Thing()],
        ["Promises", Promise.resolve()],
        ["nested non-serializables", { a: [{ b: () => 1 }] }],
    ])("rejects %s", (_, value) => {
        expect(serializable(value, [])).toBe(false);
    });

    it("accepts objects matching a serializer key", () => {
        const custom = Symbol("custom");
        expect(serializable({ x: Object.assign(new Thing(), { [custom]: true }) }, [custom])).toBe(true);
        expect(serializable(new Thing(), [v => v instanceof Thing])).toBe(true);
    });

    it("accepts shared (non-cyclic) references", () => {
        const shared = { a: 1 };
        expect(serializable({ x: shared, y: [shared] }, [])).toBe(true);
    });

    it("rejects cycles unless allowed", () => {
        const cyclic: any = { a: [] };
        cyclic.a.push(cyclic);
        expect(serializable(cyclic, [])).toBe(false);
        expect(serializable(cyclic, [], { cycles: true })).toBe(true);
        expect(serializable({ c: cyclic, f: () => 1 }, [], { cycles: true })).toBe(false);
    });
});
