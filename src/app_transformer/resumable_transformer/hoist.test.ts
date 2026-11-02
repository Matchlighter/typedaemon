import { Deferred, compileApp, useResumableHarness } from "../../../test/helpers/resumable";

/** Compile a class whose body is `members`, returning an instance (registered as the APP owner by the caller) */
const build = (members: string) => {
    const { W } = compileApp(`
import { resumable } from "typedaemon";
export class W {
${members}
}`, { Deferred });
    return W;
};

describe("resumable transformer: hoisting", () => {
    const h = useResumableHarness();

    /** Run `method` to completion (resolving Deferred "d" with `value`), optionally via a suspend/resume round trip */
    async function run(members: string, args: any[], value: any, { suspend = false } = {}) {
        const W = build(members);
        let w = new W();
        await h.boot({ APP: w });
        const d = new Deferred("d");
        const p = w.m(...args);
        if (suspend) {
            await h.shutdown();
            w = new W();
            await h.boot({ APP: w });
            Deferred.get("d").resolve(value);
            return (w as any).__result ?? (await new Promise(r => setImmediate(r)), w.out);
        }
        d.resolve(value);
        return p;
    }

    describe("destructured declarations (td-ak1)", () => {
        it("object pattern", async () => {
            const r = await run(`@resumable async m() { const { a, b } = await Deferred.get("d"); return a + b; }`, [], { a: 1, b: 2 });
            expect(r).toBe(3);
        });

        it("array pattern with holes", async () => {
            const r = await run(`@resumable async m() { const [a, , b] = await Deferred.get("d"); return a + b; }`, [], [1, 9, 2]);
            expect(r).toBe(3);
        });

        it("nested patterns, renames, defaults, rest", async () => {
            const r = await run(`@resumable async m() {
                const { a: { b: [c, d = 10, ...e] }, f = 5, ...g } = await Deferred.get("d");
                return [c, d, e, f, g];
            }`, [], { a: { b: [1, undefined, 3, 4] }, x: 1, y: 2 });
            expect(r).toEqual([1, 10, [3, 4], 5, { x: 1, y: 2 }]);
        });

        it("computed key and default referencing earlier binding", async () => {
            const r = await run(`@resumable async m() {
                const k = "z";
                const { [k]: v, w = v + 1 } = await Deferred.get("d");
                return [v, w];
            }`, [], { z: 4 });
            expect(r).toEqual([4, 5]);
        });

        it("multiple declarators mixing patterns and plain ids", async () => {
            const r = await run(`@resumable async m() {
                let x = 1, { y } = await Deferred.get("d"), [z] = [3];
                return x + y + z;
            }`, [], { y: 2 });
            expect(r).toBe(6);
        });

        it("pattern without init in a for-of head (hoist side, no await in loop)", async () => {
            const r = await run(`@resumable async m() {
                const t = await Deferred.get("d");
                let sum = 0;
                for (const [a, b] of t) { sum += a * b; }
                return sum;
            }`, [], [[1, 2], [3, 4]]);
            expect(r).toBe(14);
        });

        it("for-in with plain left alongside destructured decl", async () => {
            const r = await run(`@resumable async m() {
                const { o } = await Deferred.get("d");
                const keys = [];
                for (const k in o) keys.push(k);
                return keys;
            }`, [], { o: { p: 1, q: 2 } });
            expect(r).toEqual(["p", "q"]);
        });

        it("classic for with destructured init", async () => {
            const r = await run(`@resumable async m() {
                const v = await Deferred.get("d");
                let n = 0;
                for (let [i, j] = [0, 3]; i < j; i++) n += v;
                return n;
            }`, [], 2);
            expect(r).toBe(6);
        });

        it("survives suspend/resume", async () => {
            const W = build(`
                out;
                @resumable async m() { const { a, b: [c] } = await Deferred.get("d"); this.out = a + c; }`);
            let w = new W();
            await h.boot({ APP: w });
            new Deferred("d");
            w.m();
            await h.shutdown();
            w = new W();
            await h.boot({ APP: w });
            Deferred.get("d").resolve({ a: 1, b: [2] });
            await new Promise(r => setImmediate(r));
            expect(w.out).toBe(3);
        });
    });

    describe("identifiers that are not references (td-1im)", () => {
        it("non-computed object key matching a hoisted var", async () => {
            const r = await run(`@resumable async m() { const type = await Deferred.get("d"); return { type: 1, t: type }; }`, [], "T");
            expect(r).toEqual({ type: 1, t: "T" });
        });

        it("shorthand property expands to key: value", async () => {
            const r = await run(`@resumable async m() { const message = await Deferred.get("d"); return { message }; }`, [], "hi");
            expect(r).toEqual({ message: "hi" });
        });

        it("computed key is still a reference", async () => {
            const r = await run(`@resumable async m() { const k = await Deferred.get("d"); return { [k]: 1 }; }`, [], "kk");
            expect(r).toEqual({ kk: 1 });
        });

        it("object method key and class members inside the body", async () => {
            const r = await run(`@resumable async m() {
                const name = await Deferred.get("d");
                const o = { name() { return 1; }, get val() { return 2; } };
                class C { name = 3; static value = 4; name2() { return 5; } }
                return [o.name(), o.val, new C().name, C.value, name];
            }`, [], "N");
            expect(r).toEqual([1, 2, 3, 4, "N"]);
        });

        it("class method with key matching hoisted var", async () => {
            const r = await run(`@resumable async m() {
                const foo = await Deferred.get("d");
                class C { foo() { return 7; } }
                return [new C().foo(), foo];
            }`, [], "F");
            expect(r).toEqual([7, "F"]);
        });

        it("labels matching hoisted vars", async () => {
            const r = await run(`@resumable async m() {
                const loop = await Deferred.get("d");
                let n = 0;
                loop: for (let i = 0; i < 3; i++) { for (;;) { n++; continue loop; } }
                return [n, loop];
            }`, [], "L");
            expect(r).toEqual([3, "L"]);
        });

        it("non-computed member property and optional chain", async () => {
            const r = await run(`@resumable async m() {
                const x = await Deferred.get("d");
                const o = { x: 2 };
                return [o.x, o?.x, x];
            }`, [], 1);
            expect(r).toEqual([2, 2, 1]);
        });

        it("shorthand in destructuring assignment target", async () => {
            const r = await run(`@resumable async m() {
                let a, b;
                ({ a, b } = await Deferred.get("d"));
                [a, b] = [b, a];
                return [a, b];
            }`, [], { a: 1, b: 2 });
            expect(r).toEqual([2, 1]);
        });

        it("export-style shorthand with nested object", async () => {
            const r = await run(`@resumable async m() {
                const a = await Deferred.get("d"), b = 2;
                return { o: { a, b }, a };
            }`, [], 1);
            expect(r).toEqual({ o: { a: 1, b: 2 }, a: 1 });
        });
    });

    describe("scoping", () => {
        it("inner function param shadowing a hoisted var is untouched", async () => {
            const r = await run(`@resumable async m() {
                const x = await Deferred.get("d");
                const f = function (x) { return x * 2; };
                const g = (x) => x * 3;
                const h = ({ x }) => x * 4;
                return [f(1), g(1), h({ x: 1 }), x];
            }`, [], 9);
            expect(r).toEqual([2, 3, 4, 9]);
        });

        it("closures capture hoisted vars", async () => {
            const r = await run(`@resumable async m() {
                let x = await Deferred.get("d");
                const inc = () => ++x;
                inc(); inc();
                return x;
            }`, [], 1);
            expect(r).toBe(3);
        });

        it("inner function-scoped declaration shadowing is untouched", async () => {
            const r = await run(`@resumable async m() {
                const x = await Deferred.get("d");
                const f = () => { const x = 5; return x; };
                return [f(), x];
            }`, [], 1);
            expect(r).toEqual([5, 1]);
        });

        it("catch param does not leak", async () => {
            const r = await run(`@resumable async m() {
                const e = await Deferred.get("d");
                try { throw 1; } catch (err) { return [err, e]; }
            }`, [], 2);
            expect(r).toEqual([1, 2]);
        });
    });

    describe("method params (td-6is)", () => {
        it("destructured object param", async () => {
            const r = await run(`@resumable async m({ a, b }) { const d = await Deferred.get("d"); return a + b + d; }`, [{ a: 1, b: 2 }], 3);
            expect(r).toBe(6);
        });

        it("array, default, rest, mixed params", async () => {
            const r = await run(`@resumable async m(p, [q], { r } = { r: 3 }, s = 4, ...rest) {
                const d = await Deferred.get("d");
                return [p, q, r, s, rest, d];
            }`, [1, [2]], 9);
            expect(r).toEqual([1, 2, 3, 4, [], 9]);
        });

        it("survives suspend/resume with destructured params", async () => {
            const W = build(`
                out;
                @resumable async m({ a }, [b]) { const d = await Deferred.get("d"); this.out = a + b + d; }`);
            let w = new W();
            await h.boot({ APP: w });
            new Deferred("d");
            w.m({ a: 1 }, [2]);
            await h.shutdown();
            w = new W();
            await h.boot({ APP: w });
            Deferred.get("d").resolve(3);
            await new Promise(r => setImmediate(r));
            expect(w.out).toBe(6);
        });
    });
});
