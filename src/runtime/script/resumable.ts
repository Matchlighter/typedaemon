import { current } from "../../hypervisor/current";
import { ResumableMethod } from "../resumable/resumable_method";
import { resumableCallbackFactory } from "../resumable/resumable_promise";
import { ScriptOptions, ScriptQueueItem, ScriptStateStore } from "./store";

export class ResumableScriptStoreManager {
    protected application = current.application;

    static current() {
        return current.application.getLocalStore(ResumableScriptStoreManager, () => new ResumableScriptStoreManager());
    }

    private defined_stores: Record<string, ScriptOptions> = {};
    private loaded_stores: Record<string, ScriptStateStore> = {};

    // NB: Runs (running or queued) are NOT persisted here. They are ResumableMethods, saved with the
    //   ResumableStore; `hookScriptCallback` re-registers them with their store when they resume.

    async defineSubStore(sid: string, config: ScriptOptions) {
        this.defined_stores[sid] = config;
    }

    lookupStore(sid: string, ukey: string): ScriptStateStore {
        const key = `${sid}:${ukey}`;
        let store = this.loaded_stores[key];
        if (store) return store;

        const cfg = this.defined_stores[sid];
        if (!cfg) throw new Error(`No such script defined: ${sid}`);

        const created = store = this.loaded_stores[key] ??= new SelfCleaningScriptStateStore(cfg, () => {
            delete this.loaded_stores[key];
            this.application.scripts.detach(sid, created);
        });

        this.application.scripts.attach(sid, store);

        return store;
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

    // If queued present, start the next one.
    // (Not `finally`: it would re-throw, leaving an unhandled rejection on this bookkeeping promise. Callers observe the rejection via `script` itself.)
    const checkin = () => { store.checkin(script); };
    p.then(checkin, checkin, true);
})
