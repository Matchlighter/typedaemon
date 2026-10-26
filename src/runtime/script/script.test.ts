import "../../../test/helpers/mock_hypervisor";

import { useTempDir } from "../../../test/helpers/fs";
import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { current } from "../../hypervisor/current";
import { script } from ".";
import { ResumableScriptStoreManager } from "./resumable";
import type { ScriptOptions } from "./store";

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

describe.each(["kill", "suspend"])("@script queue cancellation (shutdown: %s)", (shutdown) => {
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
        if (shutdown === "suspend") {
            await ResumableScriptStoreManager.current().defineSubStore("run", full);
        }
        return new Worker();
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

    it("restart mode cancels the oldest queued run when called again", async () => {
        const w = await makeWorker({ mode: "restart", limit: 1 });
        track(w.run("a"));
        const second = track(w.run("b")); // queued behind a
        await flushMicrotasks();

        const third = track(w.run("c")); // evicts b
        await flushMicrotasks();

        expect(second.settled).toBe(true);
        expect(second.rejected).toBeTruthy();
        expect(third.settled).toBe(false);
    });
});
