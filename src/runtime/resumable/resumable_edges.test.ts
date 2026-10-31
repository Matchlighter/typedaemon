import { Deferred, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { current } from "../../hypervisor/current";
import { resumable, ResumableCallbackPromise } from "./resumable_method";
import {
    ResumablePromise,
    SettledPromise,
    resumableCallbackFactory,
    type SerializeContext,
} from "./resumable_promise";
import { ResumableStore } from "./resumable_store";

/** Waits on several dependencies and settles like the last one; exposes how they were persisted after a round trip */
class Waiter extends ResumablePromise<any> {
    static made = new Map<string, Waiter>();

    constructor(readonly deps: PromiseLike<any>[], readonly tag: string) {
        super();
        Waiter.made.set(tag, this);
        const last = deps[deps.length - 1];
        last.then(v => this.resolve(v), e => this.reject(e), this as any);
        for (const d of deps.slice(0, -1)) d.then(() => { }, () => { }, this as any);
    }

    static {
        ResumablePromise.defineClass<Waiter>({
            type: "test:waiter",
            resumer: (data, { require }) => new this(data.deps.map((_, i) => require(i)), data.tag),
        });
    }

    protected awaiting_for() { return this.deps; }

    serialize(ctx: SerializeContext) {
        ctx.set_type("test:waiter");
        ctx.side_effects(true);
        return { deps: this.deps.map(d => ctx.ref(d as any)), tag: this.tag };
    }
}

/** Never agrees to suspend, and does not mind being forced to */
class Stubborn extends ResumablePromise<any> {
    protected can_suspend() { return false; }
    force_suspend() { /* refuses */ }
    serialize(ctx: SerializeContext) { ctx.set_type("test:stubborn"); ctx.side_effects(false); return {}; }
}

const outcome = (p: PromiseLike<any>) => {
    const o = { settled: false, value: undefined as any, error: undefined as any };
    p.then(v => { o.settled = true; o.value = v; }, e => { o.settled = true; o.error = e; });
    return o;
};

describe("ResumablePromise default store", () => {
    it("reads the store off the current application", () => {
        const store = {};
        (current as any).application = { resumableStore: store };
        try {
            // The harness replaces `get_store`; the shipped implementation is what real code uses
            const real = Object.getOwnPropertyDescriptor(ResumablePromise, "get_store").value;
            expect(real()).toBe(store);
        } finally {
            delete (current as any).application;
        }
    });
});

describe("settled promises across a suspend", () => {
    const h = useResumableHarness();

    beforeEach(async () => {
        Waiter.made.clear();
        await h.boot();
    });

    /** Persist a Waiter on `settled` + a still pending `last`, restart, and hand back the resumed Waiter */
    async function roundTrip(settle: (d: Deferred) => void) {
        const settled = new Deferred("settled");
        settle(settled);
        new Waiter([settled, new Deferred("last", true)], "w");
        await flushMicrotasks();
        await h.shutdown();
        Deferred.reset();
        Waiter.made.clear();
        await h.boot();
        return { w: Waiter.made.get("w") }; // (boxed: a Waiter is a thenable)
    }

    it("an accepted dependency comes back as an accepted SettledPromise", async () => {
        const { w } = await roundTrip(d => d.resolve({ n: 5 }));
        const dep = w.deps[0] as SettledPromise<any>;
        expect(dep).toBeInstanceOf(SettledPromise);
        expect(dep.promise_state).toBe("accepted");
        expect(dep.promise_value).toEqual({ n: 5 });
        expect(Deferred.get("settled")).toBeUndefined();
    });

    it("a rejected Error keeps only its message", async () => {
        const { w } = await roundTrip(d => d.reject(new TypeError("kaput")));
        const dep = w.deps[0] as SettledPromise<any>;
        expect(dep.promise_state).toBe("rejected");
        expect(dep.promise_value).toBeInstanceOf(Error);
        expect(dep.promise_value.message).toBe("kaput");
        expect(dep.promise_value).not.toBeInstanceOf(TypeError);
    });

    it("a raw rejection value is preserved as is", async () => {
        const { w } = await roundTrip(d => d.reject({ code: 7 }));
        const dep = w.deps[0] as SettledPromise<any>;
        expect(dep.promise_state).toBe("rejected");
        expect(dep.promise_value).toEqual({ code: 7 });
    });

    it("the pending dependency is still live and settles the resumed Waiter", async () => {
        const { w } = await roundTrip(d => d.resolve(1));
        const o = outcome(w);
        Deferred.get("last").resolve("fin");
        await flushMicrotasks();
        expect(o.value).toBe("fin");
    });
});

describe("ResumablePromise.finally", () => {
    const h = useResumableHarness();
    beforeEach(async () => { await h.boot(); });

    it("runs the handler after a resolve and passes the value through... as the handler's result", async () => {
        const d = new Deferred("d");
        const calls: string[] = [];
        const o = outcome(d.finally(() => { calls.push("done"); }));
        d.resolve(1);
        await flushMicrotasks();
        expect(calls).toEqual(["done"]);
        expect(o.settled).toBe(true);
    });

    it("runs the handler after a rejection and rethrows the reason", async () => {
        const d = new Deferred("d");
        const calls: string[] = [];
        const o = outcome(d.finally(() => { calls.push("done"); }));
        d.reject(new Error("nope"));
        await flushMicrotasks();
        expect(calls).toEqual(["done"]);
        expect(o.error.message).toBe("nope");
    });
});

describe("all()/allSettled() entries", () => {
    const h = useResumableHarness();
    beforeEach(async () => { await h.boot(); });

    it("all() accepts plain values next to promises", async () => {
        const d = new Deferred("d");
        const o = outcome(ResumablePromise.all([1, d, "x"] as any));
        d.resolve(2);
        await flushMicrotasks();
        expect(o.value).toEqual([1, 2, "x"]);
    });

    it("all() rejects with the first rejection", async () => {
        const a = new Deferred("a");
        const b = new Deferred("b");
        const o = outcome(ResumablePromise.all([a, b]));
        b.reject("raw-reason");
        await flushMicrotasks();
        expect(o.error).toBe("raw-reason");
    });

    it("allSettled() reports plain values, fulfilments and rejections", async () => {
        const a = new Deferred("a");
        const b = new Deferred("b");
        const o = outcome(ResumablePromise.allSettled([7, a, b] as any));
        a.reject({ code: 1 });
        await flushMicrotasks();
        expect(o.settled).toBe(false);
        b.resolve("ok");
        await flushMicrotasks();
        expect(o.value).toEqual([
            { status: "fulfilled", value: 7 },
            { status: "rejected", reason: { code: 1 } },
            { status: "fulfilled", value: "ok" },
        ]);
    });

    it("allSettled() with a raw rejection survives a suspend", async () => {
        const a = new Deferred("a");
        const b = new Deferred("b");
        const all = ResumablePromise.allSettled([a, b]);
        const w = new Waiter([all], "w");
        a.reject("raw");
        await flushMicrotasks();

        await h.shutdown();
        Deferred.reset();
        Waiter.made.clear();
        await h.boot();

        Deferred.get("b").resolve(2);
        await flushMicrotasks();
        const o = outcome(Waiter.made.get("w"));
        await flushMicrotasks();
        expect(o.value).toEqual([
            { status: "rejected", reason: "raw" },
            { status: "fulfilled", value: 2 },
        ]);
        expect(w).toBeDefined();
    });

    it("a settled entry that cannot be serialized does not suspend its settler", async () => {
        const d = new Deferred("d");
        d.resolve(() => 1); // a function: not JSON serializable
        expect(SettledPromise.can_suspend(d)).toBe(false);
        const e = new Deferred("e");
        e.reject(new Error("x"));
        expect(SettledPromise.can_suspend(e)).toBe(true);
    });
});

describe("resumableCallbackFactory", () => {
    const h = useResumableHarness();
    beforeEach(async () => { await h.boot(); });

    it("follows a plain (non-resumable) promise and passes its state to the constructor", async () => {
        const seen: any[] = [];
        const make = resumableCallbackFactory<{ n: number }>("test_plain", (state, p) => { seen.push([state.n, p]); });
        let accept: (v: number) => void;
        const cb = make(new Promise<number>(r => { accept = r; }), { n: 3 });
        const o = outcome(cb);
        expect(seen[0][0]).toBe(3);
        expect(seen[0][1]).toBe(cb);
        accept(9);
        await flushMicrotasks();
        expect(o.value).toBe(9);
    });

    it("follows a plain promise's rejection", async () => {
        const make = resumableCallbackFactory<{}>("test_plain_rej", () => { });
        const cb = make(Promise.reject(new Error("bad")), {});
        const o = outcome(cb);
        await flushMicrotasks();
        expect(o.error.message).toBe("bad");
    });
});

describe("ResumableCallbackPromise (call-by-name across a restart)", () => {
    const h = useResumableHarness();
    let n = 0;
    let id: string;

    beforeEach(async () => {
        id = `cb-owner-${n++}`;
        await h.boot();
    });

    const makeOwner = () => {
        const calls: number[] = [];
        const owner = { ping: () => { calls.push(1); } };
        resumable.register_context(id, owner); // non-local: found by the default owner lookup
        return { owner, calls };
    };

    it("calls the method on the owner once the awaited promise resolves", async () => {
        const { calls } = makeOwner();
        const d = new Deferred("d");
        new ResumableCallbackPromise(d, "ping", id);
        await flushMicrotasks();
        expect(calls).toEqual([]);
        d.resolve(1);
        await flushMicrotasks();
        expect(calls).toEqual([1]);
    });

    it("does not call it when the awaited promise rejects", async () => {
        const { calls } = makeOwner();
        const d = new Deferred("d");
        new ResumableCallbackPromise(d, "ping", id);
        d.reject(new Error("x"));
        await flushMicrotasks();
        expect(calls).toEqual([]);
    });

    it("survives a suspend and calls the NEW owner, once", async () => {
        const first = makeOwner();
        const d = new Deferred("d");
        new ResumableCallbackPromise(d, "ping", id);
        await flushMicrotasks();
        const saved = await h.shutdown();
        expect(saved.map(s => s.type).sort()).toEqual(["call_by_name", "test:deferred"]);

        Deferred.reset();
        const second = makeOwner();
        await h.boot({ [id]: second.owner });
        Deferred.get("d").resolve(1);
        await flushMicrotasks();
        expect(first.calls).toEqual([]);
        expect(second.calls).toEqual([1]);
    });
});

describe("resumable owner lookup", () => {
    it("with_lookup_context takes precedence over registered owners, as an object or a function", () => {
        const registered = { who: "registered" };
        resumable.register_context("lookup-test", registered);
        expect(resumable.lookup_owner("lookup-test")).toBe(registered);

        const local = { who: "local" };
        expect(resumable.with_lookup_context({ "lookup-test": local }, () => resumable.lookup_owner("lookup-test"))).toBe(local);
        expect(resumable.with_lookup_context((k) => ({ who: k }), () => resumable.lookup_owner("lookup-test"))).toEqual({ who: "lookup-test" });
        // and it ends with the callback
        expect(resumable.lookup_owner("lookup-test")).toBe(registered);
    });

    it("an unknown id has no owner", () => {
        expect(resumable.lookup_owner("nobody-registered-this")).toBeUndefined();
    });
});

describe("ResumableStore suspend edge cases", () => {
    const h = useResumableHarness();
    beforeEach(async () => { await h.boot(); });

    it("size counts tracked resumables and drops them as they settle", async () => {
        const a = new Deferred("a");
        const b = new Deferred("b");
        expect(h.store.size).toBe(2);
        a.resolve(1);
        await flushMicrotasks();
        expect(h.store.size).toBe(1);
        b.reject(new Error("x"));
        await flushMicrotasks();
        expect(h.store.size).toBe(0);
    });

    it("loads without an owner lookup", async () => {
        new Deferred("a", true);
        await h.shutdown();
        Deferred.reset();
        h.store = new ResumableStore({ file: h.file }, undefined);
        await h.store.load();
        expect(Deferred.get("a")).toBeDefined();
    });

    it("waits for every unsuspendable resumable, not just the first one that finishes", async () => {
        class Blocker extends Stubborn {
            force_suspend() { }
            finish() { this.resolve(1); }
        }
        const slow = new Blocker();
        const quick = new Blocker();
        let saved = false;
        const saving = h.store.save().then(() => { saved = true; });
        await flushMicrotasks();

        quick.finish(); // its settling re-checks, but `slow` is still not suspended
        await flushMicrotasks();
        expect(saved).toBe(false);

        slow.finish();
        await saving;
        expect(saved).toBe(true);
    });
});

describe("ResumableStore suspend timeouts", () => {
    const h = useResumableHarness();

    beforeEach(async () => {
        jest.useFakeTimers();
        await h.boot();
    });
    afterEach(() => { jest.useRealTimers(); });

    it("gives up on a resumable that will neither finish nor suspend, and still saves the rest", async () => {
        const log = jest.spyOn(console, "log").mockImplementation(() => { });
        try {
            const stuck = new Stubborn();
            new Waiter([new Deferred("d")], "w");

            let saved = false;
            const saving = h.store.save().then(() => { saved = true; });
            await jest.advanceTimersByTimeAsync(5000); // wait for it to finish
            expect(saved).toBe(false);
            await jest.advanceTimersByTimeAsync(5000); // wait for it to suspend after forcing
            await saving;

            expect(saved).toBe(true);
            expect(log).toHaveBeenCalledWith("NOT SUSPENDED:", stuck);
            expect(h.persisted().map(s => s.type).sort()).toEqual(["test:deferred", "test:waiter"]);
        } finally {
            log.mockRestore();
        }
    });

    it("a resumable that would not suspend is not carried over the restart", async () => {
        new Waiter([new Promise(() => { })], "plain");
        const saving = h.store.save();
        await jest.advanceTimersByTimeAsync(5000); // finish wait
        await jest.advanceTimersByTimeAsync(5000); // suspend wait
        await saving;

        jest.useRealTimers();
        Deferred.reset();
        Waiter.made.clear();
        await h.boot();
        expect(Waiter.made.has("plain")).toBe(false);
    });
});

/** Serializes a reference to something that is not a ResumablePromise (that can't be persisted) */
class PlainRef extends ResumablePromise<any> {
    constructor(readonly plain: PromiseLike<any>) { super(); PlainRef.made = this; }
    static made: PlainRef;
    static {
        ResumablePromise.defineClass<PlainRef>({
            type: "test:plainref",
            resumer: (data, { require }) => new this(require(data.dep)),
        });
    }
    serialize(ctx: SerializeContext) {
        ctx.set_type("test:plainref");
        ctx.side_effects(true);
        return { dep: ctx.ref(this.plain as any) };
    }
}

describe("serializing a reference to a non-resumable promise", () => {
    const h = useResumableHarness();
    beforeEach(async () => { await h.boot(); });

    it("persists a rejection in its place instead of failing the whole save", async () => {
        new Deferred("other", true);
        new PlainRef(new Promise(() => { }));
        await h.shutdown();
        Deferred.reset();
        await h.boot();

        expect(Deferred.get("other")).toBeDefined();
        const o = outcome(PlainRef.made.plain);
        await flushMicrotasks();
        expect(o.error?.message).toBe("Promise would not suspend"); // (the stand-in itself was not suspended)
    });
});
