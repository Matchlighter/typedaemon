import * as fs from "fs";
import * as path from "path";

import { current } from "../../hypervisor/current";
import { ResumableMethod } from "../resumable/resumable_method";
import { resumableCallbackFactory } from "../resumable/resumable_promise";
import { ScriptOptions, ScriptQueueItem, ScriptStateStore } from "./store";

export class ResumableScriptStoreManager {
    protected application = current.application;

    static current() {
        return current.application.getLocalStore(ResumableScriptStoreManager, () => new ResumableScriptStoreManager());
    }

    private loaded_state;
    private defined_stores: Record<string, ScriptOptions> = {};
    private loaded_stores: Record<string, ScriptStateStore> = {};

    constructor() {
        this.application.cleanups.append(() => this.save());
    }

    get store_file() {
        return path.join(this.application.operating_directory, ".resumable_state.json")
    }

    async defineSubStore(sid: string, config: ScriptOptions) {
        this.defined_stores[sid] = config;
        await this.ensureLoaded();
    }

    lookupStore(sid: string, ukey: string): ScriptStateStore {
        this.assertLoaded();

        const key = `${sid}:${ukey}`;
        let store = this.loaded_stores[key];
        if (store) return store;

        const cfg = this.defined_stores[sid];
        if (!cfg) throw new Error(`No such script defined: ${sid}`);

        store = this.loaded_stores[key] ??= new SelfCleaningScriptStateStore(cfg, () => {
            delete this.loaded_stores[key];
        });

        store.pendingScripts = this.loaded_state[key] ?? [];
        delete this.loaded_state[key];

        return store;
    }

    protected async save() {
        const saved_state = { ...this.loaded_state };
        for (let key in this.loaded_stores) {
            const store = this.loaded_stores[key];
            if (store.pendingScripts.length > 0) {
                saved_state[key] = store.pendingScripts;
            }
        }
        await fs.promises.writeFile(this.store_file, JSON.stringify(saved_state));
    }

    protected async load() {
        try {
            const restore_json = await fs.promises.readFile(this.store_file);
            this.loaded_state = JSON.parse(restore_json.toString());
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                this.loaded_state = {};
            } else {
                throw err;
            }
        }
    }

    protected async ensureLoaded() {
        if (this.loaded_state === undefined) {
            await this.load();
        }
    }

    protected assertLoaded() {
        if (this.loaded_state === undefined) {
            throw new Error("ResumableScriptStoreManager not loaded!");
        }
    }
}

class SelfCleaningScriptStateStore extends ScriptStateStore {
    constructor(configuration: ScriptOptions, readonly onEmpty: () => void) {
        super(configuration);
    }

    checkin(script: ScriptQueueItem = null) {
        super.checkin(script);

        if (this.runningScripts.length == 0 && this.pendingScripts.length == 0) {
            // Invoke the onEmpty callback to notify the superStore
            this.onEmpty();
        }
    }
}

export const hookScriptCallback = resumableCallbackFactory("script_callback", (state: { sid: string, ukey: string }, p) => {
    const superStore = ResumableScriptStoreManager.current();
    const store = superStore.lookupStore(state.sid, state.ukey);

    const script = p.await_for as ResumableMethod<any>;
    const executor = script.executor;

    if (!executor._started) {
        store.trackPending(script);
    } else {
        store.trackRunning(script);
    }

    p.finally(() => {
        // If queued present, start the next one
        store.checkin(script);
    }, true);
})
