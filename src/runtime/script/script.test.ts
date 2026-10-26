import "../../../test/helpers/mock_hypervisor";

import { useTempDir } from "../../../test/helpers/fs";
import { LifecycleHelper } from "../../common/lifecycle_helper";
import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { current } from "../../hypervisor/current";
import { flushPluginAnnotations } from "../../plugins/base";
import { script } from ".";
import { ResumableScriptStoreManager } from "./resumable";
import { ScriptOptions, ScriptStateStore } from "./store";

const source = (options: object) => `
import { script } from "typedaemon";

export class Worker {
    @script(${JSON.stringify(options)})
    async run(key) {
        await new Deferred(key);
    }
}
`;

/** Settle state of a script-call result */
function track(result: any) {
    const state = { settled: false, rejected: null as any };
    result.then(() => { state.settled = true; }, (err) => { state.settled = true; state.rejected = err; });
    return state;
}

describe.each(["kill", "suspend", "wait"])("@script queue cancellation (shutdown: %s)", (shutdown) => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-");

    beforeEach(async () => {
        const local = new Map();
        (current as any).application = {
            operating_directory: tmp.dir,
            getLocalStore: (cls, factory) => {
                if (!local.has(cls)) local.set(cls, factory());
                return local.get(cls);
            },
            cleanups: {
                append: () => { },
                unorderedGroup: () => ({ push: () => { }, remove: () => { } }),
            },
        };
        await h.boot();
    });

    afterEach(() => {
        delete (current as any).application;
    });

    async function makeWorker(options: Omit<ScriptOptions, "shutdown">) {
        const full = { ...options, shutdown } as ScriptOptions;
        const { Worker } = compileApp(source(full), { Deferred }, { typedaemon: { script } });
        const worker = new Worker();
        await flushPluginAnnotations(worker);
        return worker;
    }

    it("cancelling a queued run settles it and frees its queue slot", async () => {
        const w = await makeWorker({ mode: "queued", limit: 2 });
        const running = track(w.run("a"));
        const queued = w.run("b");
        const queuedState = track(queued);
        await flushMicrotasks();

        expect(w.run("c")).toBe(false); // full: 1 running + 1 queued

        queued.cancel(new Error("stop"));
        await flushMicrotasks();

        expect(queuedState.settled).toBe(true);
        expect(queuedState.rejected?.message).toBe("stop");
        expect(running.settled).toBe(false);
        expect(w.run("d")).not.toBe(false); // slot freed
    });

    it("cancel() without a reason rejects with PromiseCancelled", async () => {
        const w = await makeWorker({ mode: "queued" });
        track(w.run("a"));
        const queued = w.run("b");
        const queuedState = track(queued);
        await flushMicrotasks();

        queued.cancel();
        await flushMicrotasks();

        expect(queuedState.rejected?.name).toBe("PromiseCancelled");
    });

    it("restart mode cancels the running run and starts the new one immediately", async () => {
        const w = await makeWorker({ mode: "restart" });
        const first = track(w.run("a"));
        await flushMicrotasks();
        expect(Deferred.get("a")).toBeDefined();

        const second = track(w.run("b"));
        await flushMicrotasks();
        expect(Deferred.get("b")).toBeDefined(); // started without waiting for a to unwind

        // a's (non-cancellable) await settles; the injected cancellation surfaces instead of its result
        Deferred.get("a").resolve(1);
        await flushMicrotasks();
        expect(first.settled).toBe(true);
        expect(first.rejected?.name).toBe("PromiseCancelled");
        expect(second.settled).toBe(false);

        Deferred.get("b").resolve(2);
        await flushMicrotasks();
        expect(second.settled).toBe(true);
        expect(second.rejected).toBeNull();
    });
});

describe("@script shutdown: 'wait'", () => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-");
    let cleanups: LifecycleHelper;

    beforeEach(async () => {
        cleanups = new LifecycleHelper();
        (current as any).application = {
            operating_directory: tmp.dir,
            cleanups,
        };
        await h.boot();
    });

    afterEach(() => {
        delete (current as any).application;
    });

    async function makeWorker(options: Omit<ScriptOptions, "shutdown">) {
        const { Worker } = compileApp(source({ ...options, shutdown: "wait" }), { Deferred }, { typedaemon: { script } });
        const worker = new Worker();
        await flushPluginAnnotations(worker);
        return worker;
    }

    it("app cleanup waits for running runs to complete", async () => {
        const w = await makeWorker({ mode: "parallel" });
        const a = track(w.run("a"));
        const b = track(w.run("b"));
        await flushMicrotasks();

        const shutdown = track(cleanups.cleanup());
        await flushMicrotasks();
        expect(shutdown.settled).toBe(false);

        Deferred.get("a").resolve(1);
        await flushMicrotasks();
        expect(a.settled).toBe(true);
        expect(shutdown.settled).toBe(false);

        Deferred.get("b").resolve(2);
        await flushMicrotasks();
        expect(b.rejected).toBeNull();
        expect(shutdown.settled).toBe(true);
    });

    it("cancels queued runs instead of starting them during shutdown", async () => {
        const w = await makeWorker({ mode: "queued" });
        const running = track(w.run("a"));
        const queued = track(w.run("b"));
        await flushMicrotasks();

        const shutdown = track(cleanups.cleanup());
        await flushMicrotasks();
        expect(queued.rejected?.name).toBe("PromiseCancelled");

        Deferred.get("a").resolve(1);
        await flushMicrotasks();
        expect(running.rejected).toBeNull();
        expect(Deferred.get("b")).toBeUndefined();
        expect(shutdown.settled).toBe(true);
    });
});

describe("@script shutdown: 'wait' once shutting down", () => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-");
    let app: any;

    beforeEach(async () => {
        app = { operating_directory: tmp.dir, cleanups: new LifecycleHelper(), state: "started" };
        (current as any).application = app;
        await h.boot();
    });

    afterEach(() => {
        delete (current as any).application;
    });

    it("refuses new runs", async () => {
        const { Worker } = compileApp(source({ mode: "parallel", shutdown: "wait" }), { Deferred }, { typedaemon: { script } });
        const w = new Worker();
        await flushPluginAnnotations(w);

        app.state = "stopping";
        expect(w.run("a")).toBe(false);
        await flushMicrotasks();
        expect(Deferred.get("a")).toBeUndefined();
    });
});

describe("ScriptStateStore.cancelAll", () => {
    it("cancels every item even if one throws", () => {
        const store = new ScriptStateStore({ mode: "restart" });
        const cancelled: string[] = [];
        const item = (name: string, fail = false) => ({
            cancel: () => { cancelled.push(name); if (fail) throw new Error("boom"); },
        }) as any;
        store.trackPending(item("p1", true));
        store.trackPending(item("p2"));
        store.trackRunning(item("r1", true));
        store.trackRunning(item("r2"));

        expect(() => store.cancelAll()).not.toThrow();
        expect(cancelled).toEqual(["p1", "p2", "r1", "r2"]);
        expect(store.total_count).toBe(0);
    });
});
