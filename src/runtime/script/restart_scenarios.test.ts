import "../../../test/helpers/mock_hypervisor";

import * as fs from "fs";

import { useTempDir } from "../../../test/helpers/fs";
import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { LifecycleHelper } from "../../common/lifecycle_helper";
import { current } from "../../hypervisor/current";
import { flushPluginAnnotations } from "../../plugins/base";
import { script } from ".";
import { resumable } from "..";
import { ResumableAllPromise } from "../resumable/resumable_promise";
import { ResumableScriptStoreManager } from "./resumable";

/**
 * Scenario tests: an application with live (suspended-mode) script runs stops, its resumables are persisted, and a
 * new run of the application boots from that file.
 */

const source = (options: object) => `
import { script, resumable } from "typedaemon";

export class Worker {
    @script(${JSON.stringify(options)})
    async run(key) {
        await new Deferred(key);
        return key + ":done";
    }

    @script(${JSON.stringify(options)})
    async fails(key) {
        await new Deferred(key);
        throw new Error("boom:" + key);
    }

    @resumable
    async inner(key) {
        const v = await new Deferred(key);
        return "inner:" + v;
    }

    @script(${JSON.stringify(options)})
    async nested(key) {
        return await this.inner(key);
    }

    @script(${JSON.stringify(options)})
    async fanOut(a, b) {
        return await All.create([new Deferred(a), new Deferred(b)]);
    }
}
`;

function track(result: any) {
    const state = { settled: false, rejected: null as any, value: undefined as any };
    result.then((v) => { state.settled = true; state.value = v; }, (err) => { state.settled = true; state.rejected = err; });
    return state;
}

describe("script({ shutdown: 'suspend' }) restart round-trips", () => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-restart-");
    let app: any;
    let local: Map<any, any>;

    function setupApp() {
        local = new Map();
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

    async function makeWorker(options: object) {
        const { Worker } = compileApp(source(options), { Deferred, All: ResumableAllPromise }, { typedaemon: { script, resumable } });
        const worker = new Worker();
        resumable.register_context("worker", worker, true);
        await flushPluginAnnotations(worker);
        return worker;
    }

    /** Stop the running application the way the hypervisor does (cleanups, then persist) and boot a new one */
    async function restart(options: object) {
        await app.cleanups.cleanup();
        await h.shutdown();
        Deferred.reset(); // the old process' promises are gone
        setupApp();
        const worker = await makeWorker(options);
        await h.boot({ worker });
        return worker;
    }

    const stores = () => ResumableScriptStoreManager.current();
    const runs = (sid: string, ukey = sid) => stores().lookupStore(sid, ukey).runs();

    beforeEach(async () => {
        setupApp();
        await h.boot();
    });

    afterEach(() => {
        delete (current as any).application;
    });

    describe("settled runs", () => {
        const opts = { mode: "queued", limit: 3, shutdown: "suspend" };

        it("a failed run is not persisted or resumed", async () => {
            const w = await makeWorker(opts);
            const failed = track(w.fails("f"));
            w.run("a");
            await flushMicrotasks();
            Deferred.get("f").resolve(1);
            await flushMicrotasks();
            expect(failed.rejected?.message).toBe("boom:f");

            await restart(opts);
            expect(Deferred.get("f")).toBeUndefined();
            expect(runs("run").map(r => r.params)).toEqual([["a"]]);
            expect(runs("fails")).toEqual([]);
        });

        it("a cancelled run is not persisted; nothing is written when no run remains", async () => {
            const w = await makeWorker(opts);
            const r = w.run("a");
            const state = track(r);
            await flushMicrotasks();
            r.cancel(new Error("stop it"));
            Deferred.get("a").resolve(1); // cancellation lands when control returns to the run
            await flushMicrotasks();
            expect(state.rejected?.message).toBe("stop it");

            await app.cleanups.cleanup();
            expect(await h.shutdown()).toBeNull();
        });

        it("a cancelled queued run is dropped but its neighbours survive", async () => {
            const w = await makeWorker(opts);
            w.run("a");
            const b = w.run("b");
            w.run("c");
            await flushMicrotasks();
            b.cancel(new Error("no b"));
            await flushMicrotasks();

            await restart(opts);
            expect(runs("run").map(r => [r.params[0], r.queued])).toEqual([["a", false], ["c", true]]);
        });

        it("a resumed run that then fails settles the store and detaches it", async () => {
            const w = await makeWorker(opts);
            w.fails("f");
            await flushMicrotasks();

            await restart(opts);
            const detach = jest.spyOn(app.scripts, "detach");
            expect(runs("fails").length).toBe(1);

            Deferred.get("f").resolve(1);
            await flushMicrotasks();
            expect(detach).toHaveBeenCalledTimes(1);
            expect(runs("fails")).toEqual([]);
        });

        it("a resumed run completes and frees its slot for a new call", async () => {
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();

            const w2 = await restart(opts);
            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(runs("run")).toEqual([]);
            expect(w2.run("b")).not.toBe(false);
        });
    });

    describe("queued runs that never started", () => {
        it("keep their order and start one at a time (queued)", async () => {
            const opts = { mode: "queued", limit: 5, shutdown: "suspend" };
            const w = await makeWorker(opts);
            w.run("a"); w.run("b"); w.run("c");
            await flushMicrotasks();
            expect(Deferred.get("b")).toBeUndefined();

            await restart(opts);
            await flushMicrotasks();
            expect(runs("run").map(r => [r.params[0], r.queued])).toEqual([["a", false], ["b", true], ["c", true]]);
            expect(Deferred.get("b")).toBeUndefined();

            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(runs("run").map(r => [r.params[0], r.queued])).toEqual([["b", false], ["c", true]]);
            Deferred.get("b").resolve(1);
            await flushMicrotasks();
            expect(Deferred.get("c")).toBeDefined();
        });

        it("start together in parallel mode", async () => {
            const opts = { mode: "parallel", limit: 2, shutdown: "suspend" };
            const w = await makeWorker(opts);
            w.run("a"); w.run("b");
            expect(w.run("c")).toBe(false);
            await flushMicrotasks();

            await restart(opts);
            await flushMicrotasks();
            expect(runs("run").map(r => r.queued)).toEqual([false, false]);
        });

        it("single mode: the one run resumes and still blocks new calls", async () => {
            const opts = { mode: "single", shutdown: "suspend" };
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();

            const w2 = await restart(opts);
            expect(runs("run").length).toBe(1);
            expect(w2.run("b")).toBe(false);
            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(w2.run("b")).not.toBe(false);
        });

        it("restart mode: a new call cancels the resumed run", async () => {
            const opts = { mode: "restart", shutdown: "suspend" };
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();

            const w2 = await restart(opts);
            const second = track(w2.run("b"));
            await flushMicrotasks();
            expect(runs("run").map(r => r.params[0])).toEqual(["b"]);
            expect(second.settled).toBe(false);
        });

        it("a limit lowered across the restart keeps every persisted run but admits no new ones", async () => {
            const w = await makeWorker({ mode: "queued", limit: 4, shutdown: "suspend" });
            w.run("a"); w.run("b"); w.run("c");
            await flushMicrotasks();

            const w2 = await restart({ mode: "queued", limit: 1, shutdown: "suspend" });
            await flushMicrotasks();
            expect(runs("run").map(r => [r.params[0], r.queued])).toEqual([["a", false], ["b", true], ["c", true]]);
            expect(w2.run("d")).toBe(false);

            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(w2.run("d")).toBe(false); // still over the limit
            Deferred.get("b").resolve(1);
            await flushMicrotasks();
            Deferred.get("c").resolve(1);
            await flushMicrotasks();
            expect(w2.run("d")).not.toBe(false);
        });

        it("runs that had started stay running when the mode becomes more serial", async () => {
            const w = await makeWorker({ mode: "parallel", limit: 3, shutdown: "suspend" });
            w.run("a"); w.run("b");
            await flushMicrotasks();

            await restart({ mode: "queued", limit: 3, shutdown: "suspend" });
            await flushMicrotasks();
            expect(runs("run").map(r => r.queued)).toEqual([false, false]);
        });

        it("separate scripts resume into their own stores", async () => {
            const opts = { mode: "single", shutdown: "suspend" };
            const w = await makeWorker(opts);
            w.run("a");
            w.fails("b");
            await flushMicrotasks();

            await restart(opts);
            expect(runs("run").map(r => r.params)).toEqual([["a"]]);
            expect(runs("fails").map(r => r.params)).toEqual([["b"]]);
        });
    });

    describe("runs mid-await on different resumable promises", () => {
        const opts = { mode: "parallel", shutdown: "suspend" };

        it("a plain ResumablePromise", async () => {
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();
            await restart(opts);
            expect(runs("run").length).toBe(1);
            Deferred.get("a").resolve(1);
            await flushMicrotasks();
            expect(runs("run")).toEqual([]);
        });

        it("a nested @resumable call", async () => {
            const w = await makeWorker(opts);
            w.nested("n");
            await flushMicrotasks();

            await restart(opts);
            await flushMicrotasks();
            expect(runs("nested").length).toBe(1);
            Deferred.get("n").resolve("v");
            await flushMicrotasks();
            expect(runs("nested")).toEqual([]);
        });

        it("an all() over several promises, one already settled before the stop", async () => {
            const w = await makeWorker(opts);
            w.fanOut("x", "y");
            await flushMicrotasks();
            Deferred.get("x").resolve(1);
            await flushMicrotasks();

            await restart(opts);
            await flushMicrotasks();
            expect(runs("fanOut").length).toBe(1);
            Deferred.get("y").resolve(2);
            await flushMicrotasks();
            expect(runs("fanOut")).toEqual([]);
        });

        it("survives two restarts in a row", async () => {
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();
            await restart(opts);
            await restart(opts);
            expect(runs("run").map(r => r.params)).toEqual([["a"]]);
            expect(h.store.list().map(r => r.restarts)).toEqual([2]);
        });
    });

    describe("persisted files", () => {
        const opts = { mode: "queued", limit: 3, shutdown: "suspend" };

        it("a stale .script_state.json from the old manager is ignored and left alone", async () => {
            const stale = { run: { queue: [{ params: ["ghost"] }] } };
            tmp.write(".script_state.json", JSON.stringify(stale));
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();

            await restart(opts);
            expect(runs("run").map(r => r.params)).toEqual([["a"]]);
            expect(JSON.parse(tmp.read(".script_state.json"))).toEqual(stale);
        });

        it("the ResumableStore file is the only thing written for script runs", async () => {
            const w = await makeWorker(opts);
            w.run("a");
            await flushMicrotasks();
            await app.cleanups.cleanup();
            await h.shutdown();
            expect(fs.readdirSync(tmp.dir).filter(f => f.startsWith("."))).toEqual([]);
            expect(Array.isArray(h.persisted())).toBe(true);
        });
    });
});
