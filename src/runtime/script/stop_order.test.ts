import "../../../test/helpers/mock_hypervisor";

import { useTempDir } from "../../../test/helpers/fs";
import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { LifecycleHelper } from "../../common/lifecycle_helper";
import { current } from "../../hypervisor/current";
import { flushPluginAnnotations } from "../../plugins/base";
import { script } from ".";
import { resumable } from "..";
import { ResumableScriptStoreManager } from "./resumable";
import { decodeResumableFrame } from "../resumable/resumable_method";

/** One method per `shutdown` mode, all queued so that the second call is not started */
const source = `
import { script } from "typedaemon";

export class Worker {
    @script({ mode: "queued", limit: 3, shutdown: "suspend" })
    async suspended(key) { await new Deferred(key); }

    @script({ mode: "queued", limit: 3, shutdown: "kill" })
    async killed(key) { await new Deferred(key); }

    @script({ mode: "queued", limit: 3, shutdown: "wait" })
    async waited(key) { await new Deferred(key); }
}
`;

function track(result: any) {
    const state = { settled: false, rejected: null as any };
    result.then(() => { state.settled = true; }, (err) => { state.settled = true; state.rejected = err; });
    return state;
}

describe("application stop with scripts of every shutdown mode", () => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-stop-");
    let app: any;

    function setupApp() {
        const local = new Map();
        app = {
            operating_directory: tmp.dir,
            state: "started",
            scripts: { define: () => { }, attach: () => { }, detach: () => { } },
            getLocalStore: (cls, factory) => {
                if (!local.has(cls)) local.set(cls, factory());
                return local.get(cls);
            },
            cleanups: new LifecycleHelper(),
        };
        (current as any).application = app;
    }

    async function makeWorker() {
        const { Worker } = compileApp(source, { Deferred }, { typedaemon: { script } });
        const worker = new Worker();
        resumable.register_context("worker", worker, true);
        await flushPluginAnnotations(worker);
        return worker;
    }

    beforeEach(async () => {
        setupApp();
        await h.boot();
    });

    afterEach(() => {
        delete (current as any).application;
    });

    describe("persistence", () => {
        it("kill: running and queued runs are cancelled and nothing is persisted", async () => {
            const w = await makeWorker();
            const a = track(w.killed("a"));
            const b = track(w.killed("b"));
            await flushMicrotasks();

            await app.cleanups.cleanup();
            Deferred.get("a").resolve(1); // cancellation lands when control returns to the run
            await flushMicrotasks();
            expect(a.rejected?.message).toBe("Script killed due to application shutdown");
            expect(b.settled).toBe(true);
            expect(Deferred.get("b")).toBeUndefined(); // never started
            expect(await h.shutdown()).toBeNull();
        });

        it("wait: holds the stop until the run completes, cancels the queue, and persists nothing", async () => {
            const w = await makeWorker();
            const a = track(w.waited("a"));
            const b = track(w.waited("b"));
            await flushMicrotasks();

            const stop = track(app.cleanups.cleanup());
            await flushMicrotasks();
            expect(stop.settled).toBe(false);
            expect(b.rejected?.name).toBe("PromiseCancelled");

            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(stop.settled).toBe(true);
            expect(a.rejected).toBeNull();
            expect(await h.shutdown()).toBeNull();
        });

        it("suspend: the stop does not wait or cancel, and both runs are persisted", async () => {
            const w = await makeWorker();
            // NB: not `track`ed - a non-resumable awaiter would hold up suspending
            w.suspended("a");
            w.suspended("b");
            await flushMicrotasks();

            await app.cleanups.cleanup();
            expect(ResumableScriptStoreManager.current().lookupStore("suspended", "suspended").total_count).toBe(2);

            const saved = await h.shutdown();
            const scripts = saved.filter(s => s.type === "@resumable");
            expect(scripts.map(s => [s.data.scope.method, decodeResumableFrame(s.data).parameters, s.data.started, s.data.script]))
                .toEqual([["suspended", ["a"], true, true], ["suspended", ["b"], false, true]]);
        });

        it("a mixed app only carries its suspend scripts over the restart", async () => {
            const w = await makeWorker();
            w.suspended("s");
            w.killed("k");
            w.waited("w");
            await flushMicrotasks();

            const stop = app.cleanups.cleanup();
            await flushMicrotasks();
            Deferred.get("k").resolve(1); // the kill is cooperative: it lands once the run's await returns
            Deferred.get("w").resolve(1); // let the wait script finish
            await stop;
            const saved = await h.shutdown();
            expect(saved.filter(s => s.type === "@resumable").map(s => s.data.scope.method)).toEqual(["suspended"]);

            Deferred.reset();
            setupApp();
            await h.boot({ worker: await makeWorker() });
            const store = ResumableScriptStoreManager.current();
            expect(store.lookupStore("suspended", "suspended").runs().map(r => r.params)).toEqual([["s"]]);
            expect(() => store.lookupStore("killed", "killed")).toThrow(/No such script defined/);
        });
    });

    describe("while the app is `stopping` (BaseInstance.beginShutdown), before its cleanups run", () => {
        it("kill and wait scripts refuse new runs; they would be missed by the cleanups", async () => {
            const w = await makeWorker();
            app.state = "stopping";
            expect(w.killed("a")).toBe(false);
            expect(w.waited("b")).toBe(false);
            await flushMicrotasks();
            expect(Deferred.get("a")).toBeUndefined();
            expect(Deferred.get("b")).toBeUndefined();
        });

        it.each(["stopping", "stopped", "dead"])("also in state %s", async (state) => {
            const w = await makeWorker();
            app.state = state;
            expect(w.killed("a")).toBe(false);
        });

        it("a suspend script still accepts a run, and it is carried over the restart", async () => {
            const w = await makeWorker();
            app.state = "stopping";
            const r = w.suspended("a");
            expect(r).not.toBe(false);
            await flushMicrotasks();

            await app.cleanups.cleanup();
            const saved = await h.shutdown();
            expect(saved.some(s => s.type === "@resumable" && decodeResumableFrame(s.data).parameters[0] === "a")).toBe(true);
        });

        it("a run that was started before the stop is still cancelled by the cleanups", async () => {
            const w = await makeWorker();
            const a = track(w.killed("a"));
            await flushMicrotasks();

            app.state = "stopping";
            expect(w.killed("b")).toBe(false);
            await app.cleanups.cleanup();
            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(a.rejected?.message).toBe("Script killed due to application shutdown");
        });

        it("a finished run unregisters its cleanup: a later stop has nothing to wait for", async () => {
            const w = await makeWorker();
            const a = track(w.waited("a"));
            await flushMicrotasks();
            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(a.settled).toBe(true);

            const stop = track(app.cleanups.cleanup());
            await flushMicrotasks();
            expect(stop.settled).toBe(true);
        });
    });
});
