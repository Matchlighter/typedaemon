import "../../../test/helpers/mock_hypervisor";

import { useTempDir } from "../../../test/helpers/fs";
import { Deferred, compileApp, flushMicrotasks, useResumableHarness } from "../../../test/helpers/resumable";
import { current } from "../../hypervisor/current";
import { flushPluginAnnotations } from "../../plugins/base";
import { script } from ".";
import { resumable } from "..";
import { ResumableScriptStoreManager } from "./resumable";

const source = `
import { script } from "typedaemon";

export class Worker {
    @script({ mode: "queued", limit: 3, shutdown: "suspend" })
    async run(key) {
        await new Deferred(key);
    }
}
`;

describe("@script({ shutdown: 'suspend' }) application stop", () => {
    const h = useResumableHarness();
    const tmp = useTempDir("td-script-suspend-");
    let cleanups: Array<() => any>;

    function setupApp() {
        const local = new Map();
        cleanups = [];
        (current as any).application = {
            operating_directory: tmp.dir,
            scripts: { define: () => { }, attach: () => { }, detach: () => { } },
            getLocalStore: (cls, factory) => {
                if (!local.has(cls)) local.set(cls, factory());
                return local.get(cls);
            },
            cleanups: {
                append: (f) => { cleanups.push(f); },
                unorderedGroup: () => ({ push: () => { }, remove: () => { } }),
            },
        };
    }

    async function makeWorker(id: string) {
        const { Worker } = compileApp(source, { Deferred }, { typedaemon: { script } });
        const worker = new Worker();
        resumable.register_context(id, worker, true);
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

    it("saves script state without a serialization error, and runs survive a restart", async () => {
        const w = await makeWorker("worker");
        w.run("a");
        w.run("b"); // queued behind a
        await flushMicrotasks();

        // What the application's disposers do on stop
        for (const f of cleanups) await f();
        await h.shutdown();

        setupApp();
        await h.boot({ worker: await makeWorker("worker") });
        const store = ResumableScriptStoreManager.current().lookupStore("run", "run");
        expect(store.runs().map(r => r.params)).toEqual([["a"], ["b"]]);
    });
});
