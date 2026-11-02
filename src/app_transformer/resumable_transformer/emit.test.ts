import { Deferred, compileApp, useResumableHarness } from "../../../test/helpers/resumable";

/** Gate keys follow evaluation order (any argument is ignored), so `values[i]` resolves the i-th gate reached */
let gates = 0;
const gate = (_?: any) => new Deferred("g" + gates++);

/** Results go to a sink outside the instance, so they're visible after a suspend/resume swaps instances */
const sink: { v?: any } = {};

const build = (members: string) => {
    const { W } = compileApp(`
import { resumable } from "typedaemon";
export class W {
get out() { return sink.v; }
set out(v) { sink.v = v; }
${members}
}`, { Deferred, gate, sink });
    return W;
};

const tick = () => new Promise(r => setImmediate(r));

/**
 * Each case is a `@resumable async m()` body that awaits `gate(0)`, `gate(1)`, ... in order and ends with `this.out = ...`.
 * `values[i]` resolves the i-th gate reached. Every case runs straight through, and again with a full suspend/resume at each gate.
 */
type Case = {
    name: string; body: string; values?: any[]; args?: any[]; expected: any;
    /** Known-broken in both modes: runs as `it.failing` until the bead is fixed */
    bug?: string;
    /** Known-broken only across a suspend/resume */
    suspendBug?: string;
};

/** `it`, or `it.failing` (bounded, as some known bugs hang) tagged with the bead when `bug` is set */
const itKnown = (name: string, bug: string | undefined, fn: () => Promise<void>) =>
    bug ? it.failing(`${name} [known: ${bug}]`, fn, 3000) : it(name, fn);

const cases: Case[] = [
    // --- loops containing await (td-20n) ---
    {
        name: "for-of with await in body",
        body: `const r = []; for (const x of [1, 2]) { r.push(x + await gate(x - 1)); } this.out = r;`,
        values: [10, 20], expected: [11, 22],
    },
    {
        name: "for-of with await in iterable expression",
        body: `const r = []; for (const x of await gate(0)) r.push(x); this.out = r;`,
        values: [[1, 2, 3]], expected: [1, 2, 3],
    },
    {
        name: "for-of destructured left with await",
        body: `const r = []; let i = 0; for (const [a, b] of [[1, 2], [3, 4]]) { r.push(a + b + await gate(i++)); } this.out = r;`,
        values: [100, 200], expected: [103, 207],
    },
    {
        name: "for-of with existing-variable left",
        body: `let x; const r = []; for (x of [1, 2]) { r.push(x * await gate(x - 1)); } this.out = [r, x];`,
        values: [10, 10], expected: [[10, 20], 2],
    },
    {
        name: "for-of break/continue",
        body: `const r = []; let i = 0; for (const x of [1, 2, 3, 4]) { if (x == 2) continue; if (x == 4) break; r.push(await gate(i++)); } this.out = r;`,
        values: ["a", "b"], expected: ["a", "b"],
    },
    {
        name: "for-of over a Map and a string (non-array iterables)",
        body: `const r = []; let i = 0; for (const [k, v] of new Map([["a", 1]])) r.push(k + v + await gate(i++)); for (const c of "xy") r.push(c + await gate(i++)); this.out = r;`,
        values: ["!", "1", "2"], expected: ["a1!", "x1", "y2"],
    },
    {
        name: "for-of closure captures per-iteration binding",
        // Loop-body bindings are hoisted to one shared `state.x`, so closures see the last value. Not for-of specific (any block-scoped binding in a loop)
        bug: "td-8tr",
        body: `const fs = []; let i = 0; for (const x of [1, 2, 3]) { await gate(i++); fs.push(() => x); } this.out = fs.map(f => f());`,
        values: [0, 0, 0], expected: [1, 2, 3],
    },
    {
        name: "nested for-of with labeled continue",
        body: `const r = []; let i = 0; outer: for (const a of [1, 2]) { for (const b of [1, 2]) { if (b == 2) continue outer; r.push(a * 10 + b + await gate(i++)); } } this.out = r;`,
        values: [0, 0], expected: [11, 21],
    },
    {
        name: "for-of return from inside loop",
        body: `for (const x of [1, 2, 3]) { if (await gate(x - 1)) { this.out = x; return; } } this.out = "none";`,
        values: [false, true], expected: 2,
    },
    {
        name: "for-in with await in body",
        body: `const r = []; let i = 0; for (const k in { a: 1, b: 2 }) r.push(k + await gate(i++)); this.out = r;`,
        values: [1, 2], expected: ["a1", "b2"],
    },
    {
        name: "for-in with await in object expression",
        body: `const r = []; for (const k in await gate(0)) r.push(k); this.out = r;`,
        values: [{ p: 1, q: 2 }], expected: ["p", "q"],
    },
    {
        name: "for-in break",
        body: `const r = []; let i = 0; for (var k in { a: 1, b: 2, c: 3 }) { r.push(await gate(i++)); if (k == "b") break; } this.out = [r, k];`,
        values: [1, 2], expected: [[1, 2], "b"],
    },
    {
        name: "for-await-of over array of Deferreds",
        // Holds the not-yet-awaited gate(1) across a suspend, which hangs save (as does `const p = gate(1); await gate(0); await p`)
        suspendBug: "td-639",
        body: `const r = []; for await (const x of [gate(0), gate(1)]) r.push(x); this.out = r;`,
        values: [1, 2], expected: [1, 2],
    },
    {
        name: "classic for with await in init, test, update and body",
        body: `const r = []; let n = 1; for (let i = await gate(0); i < await gate(n++); i += await gate(n++)) { r.push(i); n++; } this.out = r;`,
        values: [0, 2, 1, 2, 1, 2], expected: [0, 1],
    },
    {
        name: "while with await in condition",
        body: `let n = 0; let i = 0; while (await gate(i++)) n++; this.out = n;`,
        values: [1, 1, 0], expected: 2,
    },
    {
        name: "do-while with await in body and condition",
        body: `let n = 0; let i = 0; do { n += await gate(i++); } while (await gate(i++) > 0); this.out = n;`,
        values: [1, 1, 2, 0], expected: 3,
    },
    {
        name: "labeled block break",
        body: `lbl: { if (await gate(0)) break lbl; this.out = "no"; return; } this.out = "yes";`,
        values: [true], expected: "yes",
    },

    // --- try / catch / finally ---
    {
        name: "optional catch binding",
        body: `try { await gate(0); throw new Error("x"); } catch { this.out = "caught"; }`,
        values: [1], expected: "caught",
    },
    {
        name: "optional catch binding with await inside catch",
        body: `try { throw new Error("x"); } catch { this.out = await gate(0); }`,
        values: ["c"], expected: "c",
    },
    {
        name: "optional catch binding + finally",
        body: `const r = []; try { await gate(0); throw 1; } catch { r.push("c"); } finally { r.push(await gate(1)); } this.out = r;`,
        values: [0, "f"], expected: ["c", "f"],
    },
    {
        name: "catch binding used after await in catch",
        suspendBug: "td-639",
        body: `try { await gate(0); throw new Error("boom"); } catch (e) { await gate(1); this.out = e.message; }`,
        values: [0, 0], expected: "boom",
    },
    {
        name: "destructured catch binding",
        body: `try { await gate(0); throw { code: 7, info: [1] }; } catch ({ code, info: [i] }) { this.out = [code, i, await gate(1)]; }`,
        values: [0, "z"], expected: [7, 1, "z"],
    },
    {
        name: "catch param shadows an outer hoisted var",
        body: `const e = await gate(0); try { throw 1; } catch (e) { await gate(1); this.out = [e]; return; }`,
        values: ["outer", 0], expected: [1],
    },
    {
        name: "finally runs on return",
        body: `const r = []; try { await gate(0); r.push("t"); return; } finally { r.push(await gate(1)); this.out = r; }`,
        values: [0, "f"], expected: ["t", "f"],
    },
    {
        name: "finally overrides with its own return",
        body: `try { await gate(0); throw 1; } finally { this.out = "f"; return; }`,
        values: [0], expected: "f",
    },
    {
        name: "break out of try/finally in loop",
        body: `const r = []; let i = 0; for (const x of [1, 2, 3]) { try { if (x == 2) break; r.push(await gate(i++)); } finally { r.push("f" + x); } } this.out = r;`,
        values: ["a"], expected: ["a", "f1", "f2"],
    },
    {
        name: "continue through finally",
        body: `const r = []; let i = 0; for (const x of [1, 2]) { try { if (x == 1) continue; r.push(await gate(i++)); } finally { r.push("f" + x); } } this.out = r;`,
        values: ["a"], expected: ["f1", "a", "f2"],
    },
    {
        name: "nested try rethrow to outer catch",
        suspendBug: "td-639",
        body: `try { try { await gate(0); throw new Error("in"); } catch (e) { await gate(1); throw new Error("re:" + e.message); } } catch (e2) { this.out = e2.message; }`,
        values: [0, 0], expected: "re:in",
    },
    {
        name: "try in loop, throw on some iterations",
        body: `const r = []; let i = 0; for (const x of [1, 2, 3]) { try { if (await gate(i++)) throw x; r.push("ok" + x); } catch (e) { r.push("err" + e); } } this.out = r;`,
        values: [0, 1, 0], expected: ["ok1", "err2", "ok3"],
    },
    // --- switch ---
    {
        name: "switch with await in discriminant, case test, and body",
        body: `switch (await gate(0)) { case await gate(1): this.out = "a"; break; case 2: this.out = await gate(2); break; default: this.out = "d"; }`,
        values: [2, 1, "two"], expected: "two",
    },
    {
        name: "switch fallthrough with await",
        body: `const r = []; switch (1) { case 1: r.push(await gate(0)); case 2: r.push(await gate(1)); break; case 3: r.push("no"); } this.out = r;`,
        values: ["a", "b"], expected: ["a", "b"],
    },
    {
        name: "switch default in middle",
        body: `switch (5) { case 1: this.out = 1; break; default: this.out = await gate(0); break; case 2: this.out = 2; } `,
        values: ["dflt"], expected: "dflt",
    },
    {
        name: "continue inside switch inside loop",
        body: `const r = []; let i = 0; for (const x of [1, 2, 3]) { switch (x) { case 2: continue; default: r.push(await gate(i++)); } } this.out = r;`,
        values: ["a", "b"], expected: ["a", "b"],
    },

    // --- expressions containing await ---
    {
        name: "await in call arguments and callee",
        suspendBug: "td-639",
        body: `const f = (a, b) => a - b; this.out = f(await gate(0), await gate(1));`,
        values: [5, 2], expected: 3,
    },
    {
        name: "await in method receiver and args",
        body: `this.out = (await gate(0)).concat(await gate(1));`,
        values: [[1], [2]], expected: [1, 2],
    },
    {
        name: "await in new expression",
        suspendBug: "td-639",
        body: `this.out = new Array(await gate(0)).length;`,
        values: [3], expected: 3,
    },
    {
        name: "await in short-circuit operators",
        body: `this.out = [(await gate(0)) && (await gate(1)), (await gate(2)) || (await gate(3)), (await gate(4)) ?? (await gate(5))];`,
        values: [1, "a", 0, "b", null, "c"], expected: ["a", "b", "c"],
    },
    {
        name: "short-circuit skips awaits",
        body: `let n = 0; const r = (n && await gate(0)) || (await gate(0)); this.out = r;`,
        values: ["x"], expected: "x",
    },
    {
        name: "?? short-circuits on non-nullish falsy left",
        body: `this.out = [(await gate(0)) ?? (await gate(9)), (await gate(1)) ?? "r", await gate(2)];`,
        values: [0, undefined, "z"], expected: [0, "r", "z"],
    },
    {
        name: "await in conditional branches",
        body: `this.out = (await gate(0)) ? await gate(1) : await gate(2);`,
        values: [0, "no"], expected: "no",
    },
    {
        name: "await in conditional (consequent branch)",
        body: `this.out = (await gate(0)) ? await gate(1) : await gate(2);`,
        values: [1, "yes"], expected: "yes",
    },
    {
        name: "await in array/object literal with spread",
        body: `this.out = { a: await gate(0), ...(await gate(1)), [await gate(2)]: 3, arr: [...(await gate(3)), await gate(4)] };`,
        values: [1, { b: 2 }, "k", [7], 8], expected: { a: 1, b: 2, k: 3, arr: [7, 8] },
    },
    {
        name: "await in spread call arguments",
        body: `const xs = [1]; this.out = [].concat(...xs, ...(await gate(0)), await gate(1));`,
        values: [[2, 3], 4], expected: [1, 2, 3, 4],
    },
    {
        name: "await in spread new arguments",
        suspendBug: "td-639",
        body: `this.out = new Array(...(await gate(0)));`,
        values: [[5, 6]], expected: [5, 6],
    },
    {
        name: "computed object key evaluated before its awaited value",
        body: `this.out = { [await gate(0)]: await gate(1) };`,
        values: ["a", "b"], expected: { a: "b" },
    },
    {
        name: "await in template literal and tagged template",
        // The local `tag` arrow is held in state across the awaits
        suspendBug: "td-639",
        body: `const tag = (s, ...v) => s.join("|") + v.join(","); this.out = [\`a\${await gate(0)}b\${await gate(1)}\`, tag\`x\${await gate(2)}y\`];`,
        values: [1, 2, 3], expected: ["a1b2", "x|y3"],
    },
    {
        name: "tagged template keeps this, raw strings and template object identity",
        // The tag and its receiver are functions/objects held in state across the await
        suspendBug: "td-639",
        body: `const o = { p: "P", t(s, ...v) { return [this.p, s.raw[0], v[0], s]; } }; const a = o.t\`a\\n\${await gate(0)}\`; const b = o.t\`a\\n\${await gate(1)}\`; const r = []; for (const i of [2, 3]) r.push(o.t\`z\${await gate(i)}\`[3]); this.out = [a.slice(0, 3), b[2], a[3] !== b[3], r[0] === r[1], String.raw\`q\\n\${await gate(4)}\`];`,
        values: [1, 2, 0, 0, "x"], expected: [["P", "a\\n", 1], 2, true, true, "q\\nx"],
    },
    {
        name: "template literal converts each substitution before evaluating the next",
        suspendBug: "td-639",
        body: `const r = []; const o = { toString() { r.push("s"); return "o"; } }; this.out = [\`\${o}-\${(r.push("e"), await gate(0))}\`, r];`,
        values: [1], expected: ["o-1", ["s", "e"]],
    },
    {
        name: "await in sequence, unary, binary",
        body: `this.out = [(await gate(0), await gate(1)), -(await gate(2)), typeof (await gate(3)), (await gate(4)) + (await gate(5)), "k" in (await gate(6))];`,
        values: [0, 1, 2, "s", 3, 4, { k: 1 }], expected: [1, -2, "string", 7, true],
    },
    {
        name: "await in compound / logical assignment",
        body: `let a = 1; a += await gate(0); const o = { n: null, m: 2 }; o.n ??= await gate(1); o.m &&= await gate(2); o["k"] = await gate(3); this.out = [a, o];`,
        values: [2, "N", "M", "K"], expected: [3, { n: "N", m: "M", k: "K" }],
    },
    {
        name: "await in computed member and optional chain",
        body: `const o = { a: { b: 2 } }; this.out = [o[await gate(0)].b, o?.[await gate(1)]?.b, (await gate(2))?.x?.y];`,
        values: ["a", "a", null], expected: [2, 2, undefined],
    },
    {
        name: "optional chain short-circuit skips later awaits",
        body: `const n = null; const o = { a: { b: 2 } }; this.out = [n?.a[await gate(9)].b.c, o?.a[await gate(0)], (o?.a).b, o.a?.["b"]?.toFixed(await gate(1)), n?.[await gate(9)], await gate(2)];`,
        values: ["b", 1, "z"], expected: [undefined, 2, 2, "2.0", undefined, "z"],
    },
    {
        name: "optional call with await keeps this and short-circuits",
        body: `const a = [1]; const n = null; this.out = [a?.concat(await gate(0)), n?.concat(await gate(9)), n?.x.concat(await gate(9)), a.nope?.(await gate(9)), (await gate(1))?.(1), (await gate(2))?.concat(await gate(3)), await gate(4)];`,
        values: [2, null, [7], 8, "z"], expected: [[1, 2], undefined, undefined, undefined, undefined, [7, 8], "z"],
    },
    {
        name: "optional call of a present callee with await argument",
        // The tested callee is a function held across the await
        suspendBug: "td-639",
        body: `const f = (x) => x * 2; let g; const a = [1]; this.out = [f?.(await gate(0)), g?.(await gate(9)), a.concat?.(await gate(1)), await gate(2)];`,
        values: [3, 2, "z"], expected: [6, undefined, [1, 2], "z"],
    },
    {
        name: "update expression on hoisted var and member",
        body: `let i = await gate(0); const o = { n: 1 }; i++; ++o.n; o.n--; this.out = [i, o.n, i++ + ++i];`,
        values: [1], expected: [2, 1, 6],
    },
    {
        name: "await in if / else-if chains",
        body: `if (await gate(0)) this.out = 1; else if (await gate(1)) this.out = 2; else this.out = 3;`,
        values: [0, 0], expected: 3,
    },
    {
        name: "await in throw argument",
        body: `try { throw await gate(0); } catch (e) { this.out = e; }`,
        values: ["thrown"], expected: "thrown",
    },
    {
        name: "await in return argument",
        bug: "td-epy",
        body: `this.out = await (async () => (await gate(0)) + 1)();`,
        values: [1], expected: 2,
    },

    // --- declarations / scoping ---
    {
        name: "var hoisting across blocks",
        body: `if (await gate(0)) { var x = 1; } else { var y = 2; } this.out = [x, y];`,
        values: [true], expected: [1, undefined],
    },
    {
        name: "let shadowing in nested blocks",
        body: `let x = await gate(0); { let x = 2; await gate(1); this.out = [x]; } this.out.push(x);`,
        values: [1, 0], expected: [2, 1],
    },
    {
        name: "function declaration inside resumable fn",
        suspendBug: "td-639",
        body: `const v = await gate(0); function dbl(n) { return n * 2; } this.out = dbl(v);`,
        values: [4], expected: 8,
    },
    {
        name: "arrow and nested async fn capture hoisted vars",
        bug: "td-epy",
        body: `let c = await gate(0); const inc = async () => { c += await gate(1); }; await inc(); this.out = c;`,
        values: [1, 2], expected: 3,
    },
    {
        name: "class declaration and expression inside body",
        body: `const v = await gate(0); class A { get v() { return v; } } const B = class extends A { m() { return this.v + 1; } }; this.out = new B().m();`,
        values: [1], expected: 2,
    },
    {
        name: "this and arguments preserved across awaits",
        body: `const a = arguments[0]; await gate(0); this.out = [a, arguments.length, this === this.self];`,
        args: [7, 8], values: [0], expected: [7, 2, true],
    },
];

describe("resumable transformer: emit", () => {
    const h = useResumableHarness();
    /** A timed-out (known-hanging) case keeps running in the background; it must not resolve later cases' same-named gates */
    let runId = 0;
    beforeEach(() => { sink.v = undefined; gates = 0; runId++; });

    const runCase = async (c: Case, suspend: boolean) => {
        const W = build(`self = this;\n@resumable async m() { ${c.body} }`);
        let w = new W();
        await h.boot({ APP: w });
        w.m(...(c.args ?? []));
        const id = runId;
        const values = c.values ?? [];
        for (let i = 0; i < values.length; i++) {
            await tick();
            if (suspend) {
                await h.shutdown();
                if (id !== runId) return;
                w = new W();
                await h.boot({ APP: w });
                await tick();
            }
            if (id !== runId) return;
            Deferred.get("g" + i).resolve(values[i]);
        }
        await tick();
        return w.out;
    };

    describe.each([["straight through", false], ["suspend/resume at every await", true]])("%s", (_, suspend) => {
        for (const c of cases) {
            itKnown(c.name, suspend ? c.bug ?? c.suspendBug : c.bug, async () => {
                expect(await runCase(c, suspend as boolean)).toEqual(c.expected);
            });
        }
    });

    describe("rejections and errors", () => {
        it("awaited rejection caught by try/catch", async () => {
            const W = build(`@resumable async m() { try { await gate(0); } catch (e) { this.out = "rej:" + e; } }`);
            const w = new W();
            await h.boot({ APP: w });
            w.m();
            await tick();
            Deferred.get("g0").reject("no");
            await tick();
            expect(w.out).toBe("rej:no");
        });

        it("awaited rejection caught after suspend/resume", async () => {
            const W = build(`@resumable async m() { try { await gate(0); } catch { this.out = "rej"; } }`);
            let w = new W();
            await h.boot({ APP: w });
            w.m();
            await h.shutdown();
            w = new W();
            await h.boot({ APP: w });
            await tick();
            Deferred.get("g0").reject("no");
            await tick();
            expect(w.out).toBe("rej");
        });

        it("uncaught throw rejects the method promise", async () => {
            const W = build(`@resumable async m() { await gate(0); throw new Error("bad"); }`);
            const w = new W();
            await h.boot({ APP: w });
            const p = w.m();
            await tick();
            Deferred.get("g0").resolve(0);
            await expect(p).rejects.toThrow("bad");
        });

        it("synchronous throw before first await", async () => {
            const W = build(`@resumable async m() { throw new Error("early"); }`);
            const w = new W();
            await h.boot({ APP: w });
            await expect(w.m()).rejects.toThrow("early");
        });

        it("method with no await returns value", async () => {
            const W = build(`@resumable async m(a) { return a + 1; }`);
            const w = new W();
            await h.boot({ APP: w });
            expect(await w.m(1)).toBe(2);
        });

        it("return value of awaited result is propagated to caller", async () => {
            const W = build(`@resumable async m() { const v = await gate(0); return v * 2; }`);
            const w = new W();
            await h.boot({ APP: w });
            const p = w.m();
            await tick();
            Deferred.get("g0").resolve(4);
            await expect(p).resolves.toBe(8);
        });
    });

    describe("method shapes", () => {
        it("default param referencing earlier param", async () => {
            const W = build(`@resumable async m(a, b = a + 1) { await gate(0); this.out = [a, b]; }`);
            const w = new W();
            await h.boot({ APP: w });
            w.m(1);
            await tick();
            Deferred.get("g0").resolve(0);
            await tick();
            expect(w.out).toEqual([1, 2]);
        });

        it("resumable calling another resumable", async () => {
            const W = build(`@resumable async m() { this.out = await this.other(await gate(0)); } @resumable async other(x) { return await gate(1) + x; }`);
            const w = new W();
            await h.boot({ APP: w });
            w.m();
            await tick();
            Deferred.get("g0").resolve(1);
            await tick();
            Deferred.get("g1").resolve(10);
            await tick();
            expect(w.out).toBe(11);
        });

        it("nested resumable call survives suspend/resume mid-callee", async () => {
            const W = build(`@resumable async m() { this.out = await this.other(1); } @resumable async other(x) { return (await gate(0)) + x; }`);
            let w = new W();
            await h.boot({ APP: w });
            w.m();
            await tick();
            await h.shutdown();
            w = new W();
            await h.boot({ APP: w });
            await tick();
            Deferred.get("g0").resolve(10);
            await tick();
            expect(w.out).toBe(11);
        });

        itKnown("nested async object-literal method", "td-epy", async () => {
            const W = build(`@resumable async m() { const o = { async inner() { return await gate(0); } }; this.out = await o.inner(); }`);
            const w = new W();
            await h.boot({ APP: w });
            w.m();
            await tick();
            Deferred.get("g0").resolve(5);
            await tick();
            expect(w.out).toBe(5);
        });
    });
});
