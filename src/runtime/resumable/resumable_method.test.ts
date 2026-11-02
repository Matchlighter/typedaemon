import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { decodeResumableFrame } from "./resumable_method";
import { PromiseCancelled } from "./resumable_promise";

const APP_SOURCE = `
import { resumable } from "typedaemon";

export class Worker {
    events = [];

    @resumable
    async addAfter(a) {
        const b = await Deferred.get("b");
        return this.finish(a + b);
    }

    @resumable
    async compound(a) {
        let x = a;
        x += await Deferred.get("b");
        return this.finish(x);
    }

    @resumable
    async callsWithAwait() {
        return this.finish(await Deferred.get("b"));
    }

    @resumable
    async forIn(obj) {
        const seen = [];
        for (const k in obj) {
            const v = await Deferred.get("k" + k);
            seen.push(k + "=" + v);
        }
        return this.finish(seen.join(","));
    }

    @resumable
    async awaitsReturnThroughFinally() {
        return this.finish(await this.returnsThroughFinally());
    }

    @resumable
    async returnsThroughFinally() {
        try {
            return "ret";
        } finally {
            await Deferred.get("b");
            this.events.push("cleanup");
        }
    }

    @resumable
    async counter(n) {
        let total = 0;
        for (let i = 0; i < n; i++) {
            total += i;
            await Deferred.get("tick" + i);
        }
        return this.finish(total);
    }

    @resumable
    async guarded() {
        try {
            await Deferred.get("b");
            this.events.push("try");
        } catch (ex) {
            this.events.push("catch:" + ex.message);
        } finally {
            this.events.push("finally");
        }
        return this.finish("done");
    }

    @resumable
    async outer() {
        const v = await this.inner();
        return this.finish("outer:" + v);
    }

    @resumable
    async inner() {
        const v = await Deferred.get("b");
        return "inner:" + v;
    }

    pending = null;

    @resumable
    async awaitsPending() {
        const v = await this.pending;
        return this.finish(v);
    }

    @resumable
    async holdsFunction() {
        const fn = () => "called";
        await Deferred.get("b");
        return this.finish(fn());
    }

    @resumable
    async takesCallback(cb) {
        await Deferred.get("b");
        return this.finish(cb());
    }

    @resumable
    async aliased() {
        const r = [];
        const holder = { r, self: null };
        holder.self = holder;
        await Deferred.get("b");
        r.push(1);
        return this.finish([holder.r.length, holder.self === holder]);
    }

    @resumable
    async catchesThenAwaits() {
        try {
            throw new TypeError("boom");
        } catch (e) {
            await Deferred.get("b");
            return this.finish([e instanceof TypeError, e instanceof Error, e.name, e.message, e.stack.includes("boom")]);
        }
    }

    @resumable
    async versioned() {
        await Deferred.get("b");
        return this.finish("v1");
    }

    finish(v) {
        this.events.push(v);
        return v;
    }
}
`;

const { Worker } = compileApp(APP_SOURCE, { Deferred });

/** Same app, but \`versioned\` now has an extra await - simulates the user editing a @resumable between runs */
const { Worker: WorkerV2 } = compileApp(APP_SOURCE.replace(
    `await Deferred.get("b");\n        return this.finish("v1");`,
    `await Deferred.get("b");\n        await Deferred.get("c");\n        return this.finish("v2");`,
), { Deferred });

describe("@resumable", () => {
    const h = useResumableHarness();

    /** Boot a run with a fresh Worker registered as the "APP" owner */
    async function bootWorker(Cls = Worker) {
        const worker = new Cls();
        await h.boot({ APP: worker });
        return worker;
    }

    describe("without suspension", () => {
        it("runs to completion like a normal async method", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.addAfter(1);
            d.resolve(2);
            await expect(p).resolves.toBe(3);
        });

        it("awaits native promises", async () => {
            const w = await bootWorker();
            w.pending = Promise.resolve("native");
            await expect(w.awaitsPending()).resolves.toBe("native");
        });

        it("routes rejections through try/catch/finally", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.guarded();
            d.reject(new Error("boom"));
            await expect(p).resolves.toBe("done");
            expect(w.events).toEqual(["catch:boom", "finally", "done"]);
        });

        it("rejects when an error is not caught", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.addAfter(1);
            d.reject(new Error("boom"));
            await expect(p).rejects.toThrow("boom");
        });

        it("supports awaiting other @resumable methods", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.outer();
            d.resolve("x");
            await expect(p).resolves.toBe("outer:inner:x");
        });
    });

    describe("suspension and resumption", () => {
        it("persists a method awaiting a Resumable and continues it in the next run", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.addAfter(1);

            const persisted = await h.shutdown();
            expect(persisted).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: "@resumable",
                    data: expect.objectContaining({
                        scope: { owner: "APP", method: "addAfter" },
                    }),
                }),
                expect.objectContaining({ type: "test:deferred" }),
            ]));
            expect(decodeResumableFrame(persisted.find(p => p.type == "@resumable").data).parameters).toEqual([1]);
            expect(w1.events).toEqual([]);

            const w2 = await bootWorker();
            Deferred.get("b").resolve(2);
            await flushMicrotasks();

            // Resumed against the new owner, with parameters restored
            expect(w2.events).toEqual([3]);
            expect(w1.events).toEqual([]);
        });

        it("removes the persisted file once resumed", async () => {
            await bootWorker().then(w => { new Deferred("b"); w.addAfter(1) });
            await h.shutdown();
            expect(h.persisted()).not.toBeNull();

            await bootWorker();
            expect(h.persisted()).toBeNull();
        });

        it("restores local variables", async () => {
            const w1 = await bootWorker();
            const tick0 = new Deferred("tick0");
            new Deferred("tick1");
            w1.counter(3);
            tick0.resolve(null);
            await flushMicrotasks();

            await h.shutdown();

            const w2 = await bootWorker();
            new Deferred("tick2").resolve(null);
            Deferred.get("tick1").resolve(null);
            await flushMicrotasks();

            expect(w2.events).toEqual([0 + 1 + 2]);
        });

        it("can be suspended and resumed repeatedly", async () => {
            const w1 = await bootWorker();
            new Deferred("tick0");
            w1.counter(2);
            await h.shutdown();

            await bootWorker();
            new Deferred("tick1");
            Deferred.get("tick0").resolve(null);
            await flushMicrotasks();
            await h.shutdown();

            const w3 = await bootWorker();
            Deferred.get("tick1").resolve(null);
            await flushMicrotasks();
            expect(w3.events).toEqual([1]);
        });

        it("restores compiler temporaries (eg. `x += await y`)", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.compound(1);
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("b").resolve(2);
            await flushMicrotasks();
            expect(w2.events).toEqual([3]);
        });

        it("preserves shared references and cycles across locals and temporaries", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.aliased();
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("b").resolve(null);
            await flushMicrotasks();
            expect(w2.events).toEqual([[1, true]]);
        });

        it("resumes executor data persisted in the pre-reference-preserving format", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.compound(1);
            await h.shutdown();

            // Rewrite as an older version wrote it: state/temporaries/completions/arg/sent/rval as independent plain values
            const persisted = h.persisted();
            const entry = persisted.find(p => p.type == "@resumable");
            const { frame, ...rest } = entry.data;
            expect(frame).toBeDefined();
            const { parameters, ...parts } = decodeResumableFrame(entry.data);
            entry.data = { ...rest, ...parts, scope: { ...rest.scope, parameters } };
            require("fs").writeFileSync(h.file, JSON.stringify(persisted));

            const w2 = await bootWorker();
            Deferred.get("b").resolve(2);
            await flushMicrotasks();
            expect(w2.events).toEqual([3]);
        });

        it("resumes when the callee of an awaited argument is a method on the owner (`this.m(await x)`)", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.callsWithAwait();
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("b").resolve(2);
            await flushMicrotasks();
            expect(w2.events).toEqual([2]);
        });

        it("resumes `for...in` loops mid-iteration", async () => {
            const w1 = await bootWorker();
            new Deferred("ka");
            new Deferred("kb");
            Deferred.get("ka").resolve(1);
            w1.forIn({ a: 0, b: 0 });
            await flushMicrotasks();
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("kb").resolve(2);
            await flushMicrotasks();
            expect(w2.events).toEqual(["a=1,b=2"]);
        });

        it("keeps a pending `return` while suspended inside its `finally`", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.awaitsReturnThroughFinally();
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("b").resolve(null);
            await flushMicrotasks();
            expect(w2.events).toEqual(["cleanup", "ret"]);
        });

        it("delivers rejections to try/catch/finally after resuming", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.guarded();
            await h.shutdown();

            const w2 = await bootWorker();
            Deferred.get("b").reject(new Error("later"));
            await flushMicrotasks();
            expect(w2.events).toEqual(["catch:later", "finally", "done"]);
        });

        it("persists and resumes chains of @resumable methods", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.outer();
            const persisted = await h.shutdown();
            expect(persisted.filter(p => p.type == "@resumable").map(p => p.data.scope.method).sort()).toEqual(["inner", "outer"]);

            const w2 = await bootWorker();
            Deferred.get("b").resolve("x");
            await flushMicrotasks();
            expect(w2.events).toEqual(["outer:inner:x"]);
        });

        it("does not persist anything when nothing is pending", async () => {
            const w = await bootWorker();
            new Deferred("b").resolve(1);
            await w.addAfter(1);

            // Side-effect-free and not awaited by anything with side-effects - can be dropped
            new Deferred("unawaited");

            expect(await h.shutdown()).toBeNull();
        });

        it("waits for non-resumable awaits to settle, then suspends at the next step", async () => {
            const w1 = await bootWorker();
            let resolveNative: (v: any) => void;
            w1.pending = new Promise(r => resolveNative = r);
            w1.awaitsPending();

            const shutdown = h.shutdown();
            await flushMicrotasks();
            resolveNative("native");

            const persisted = await shutdown;
            expect(persisted).toEqual([expect.objectContaining({ type: "@resumable" })]);
            expect(decodeResumableFrame(persisted[0].data).arg).toBe("native");
            expect(w1.events).toEqual([]);

            const w2 = await bootWorker();
            await flushMicrotasks();
            expect(w2.events).toEqual(["native"]);
        });

        describe("when a method cannot suspend", () => {
            beforeEach(() => {
                jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
            });
            afterEach(() => {
                jest.useRealTimers();
            });

            async function shutdownWithTimeout() {
                const shutdown = h.shutdown();
                await jest.advanceTimersByTimeAsync(20_000);
                return await shutdown;
            }

            const failures = () => h.lastSave.failed.map(f => f.error.message);

            it("force-suspends methods blocked on non-resumable promises", async () => {
                const w = await bootWorker();
                w.pending = new Promise(() => { });
                w.awaitsPending();

                // Nothing depends on it, so the forcibly-failed method is dropped
                expect(await shutdownWithTimeout()).toBeNull();
                expect(failures()).toEqual([expect.stringMatching(/APP\.awaitsPending.*awaits a non-resumable Promise/)]);
            });

            it("propagates the failure to resumable awaiters", async () => {
                const w = await bootWorker();
                w.pending = new Promise(() => { });
                w.pending = w.awaitsPending();
                w.awaitsPending();

                const persisted = await shutdownWithTimeout();
                expect(persisted).toEqual(expect.arrayContaining([
                    expect.objectContaining({ type: "settled", data: { state: { result: "reject_error", value: "Promise would not suspend" } } }),
                ]));

                const w2 = await bootWorker();
                await flushMicrotasks();
                expect(w2.events).toEqual([]);
            });

            it("does not suspend methods called with non-serializable parameters", async () => {
                const w = await bootWorker();
                new Deferred("b");
                w.takesCallback(() => "called");

                expect(await shutdownWithTimeout()).toBeNull();
                expect(failures()).toEqual([expect.stringMatching(/APP\.takesCallback.*parameters\[0\] is a function/)]);
            });

            it("does not suspend methods holding non-serializable locals", async () => {
                const w = await bootWorker();
                new Deferred("b");
                w.holdsFunction();

                expect(await shutdownWithTimeout()).toBeNull();
                expect(failures()).toEqual([expect.stringMatching(/APP\.holdsFunction.*state\.fn is a function/)]);
            });

            it("still saves (and resumes) the methods that could suspend", async () => {
                const w = await bootWorker();
                new Deferred("b");
                new Deferred("tick0");
                w.holdsFunction();
                w.counter(1);

                const persisted = await shutdownWithTimeout();
                expect(failures()).toHaveLength(1);
                expect(persisted.filter(s => s.type === "@resumable").map(s => s.data.scope.method)).toEqual(["counter"]);

                jest.useRealTimers();
                const w2 = await bootWorker();
                Deferred.get("tick0").resolve(0);
                await flushMicrotasks();
                expect(w2.events).toEqual([0]);
            });
        });

        it("persists an Error held in a local, restoring it as an Error", async () => {
            const w = await bootWorker();
            new Deferred("b");
            w.catchesThenAwaits();
            await h.shutdown();
            expect(h.lastSave.failed).toEqual([]);

            const w2 = await bootWorker();
            Deferred.get("b").resolve(0);
            await flushMicrotasks();
            // The subclass is not kept: it comes back as a plain Error carrying the original name, message and stack
            expect(w2.events).toEqual([[false, true, "TypeError", "boom", true]]);
        });
    });

    describe("code changes between runs", () => {
        it("fails to resume when control flow changed, and keeps the entry for later", async () => {
            const w1 = await bootWorker();
            new Deferred("b");
            w1.versioned();
            const persisted = await h.shutdown();

            const w2 = await bootWorker(WorkerV2);
            Deferred.get("b").resolve(null);
            await flushMicrotasks();
            expect(w2.events).toEqual([]);

            // The FailedResume is re-persisted so that a later (fixed) version may resume it
            expect(await h.shutdown()).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: "@resumable", data: persisted.find(p => p.type == "@resumable").data }),
            ]));
        });
    });

    describe("cancellation", () => {
        it("rejects with PromiseCancelled once control returns to the method", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.addAfter(1);
            p.cancel();
            d.resolve(2);
            await expect(p).rejects.toBeInstanceOf(PromiseCancelled);
            expect(w.events).toEqual([]);
        });

        it("raises the cancellation inside the method so it may be handled", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.guarded();
            p.cancel("stop it");

            // Cancellation is injected when control returns to the method
            d.resolve(null);
            await expect(p).resolves.toBe("done");
            expect(w.events).toEqual(["catch:stop it", "finally", "done"]);
        });

        it("cancels awaited @resumable methods", async () => {
            const w = await bootWorker();
            const d = new Deferred("b");
            const p = w.outer();
            p.cancel();
            d.resolve("x");

            await expect(p).rejects.toBeInstanceOf(PromiseCancelled);
            expect(w.events).toEqual([]);
        });
    });
});
