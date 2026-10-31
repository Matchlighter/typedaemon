import { TypedEmitter } from "tiny-typed-emitter";
import { scriptLimit, type ScriptOptions, type ScriptRunInfo, type ScriptStateStore } from "./store";

export interface ScriptInfo {
    name: string;
    mode: ScriptOptions['mode'];
    /** Most runs (running + queued) per call key; null for no limit */
    limit: number | null;
    running: number;
    queued: number;
    runs: ScriptRunInfo[];
}

/**
 * The scripts an app defines and what they are doing. Scripts keep their run state in per-call-key
 * `ScriptStateStore`s that come and go; this is the one place that can tell what an app's scripts are up to.
 */
export class ScriptRegistry extends TypedEmitter<{
    /** A script was defined, or its runs changed */
    change: () => void;
}> {
    private scripts = new Map<string, { options: ScriptOptions; stores: Map<ScriptStateStore, () => void> }>();

    define(name: string, options: ScriptOptions) {
        const known = this.scripts.get(name);
        if (known) {
            known.options = options;
            return;
        }
        this.scripts.set(name, { options, stores: new Map() });
        this.emit('change');
    }

    /** Report the runs of `store` as part of script `name` until `detach` */
    attach(name: string, store: ScriptStateStore) {
        const script = this.need(name);
        if (script.stores.has(store)) return;
        const onChange = () => this.emit('change');
        store.on('change', onChange);
        script.stores.set(store, () => store.off('change', onChange));
        this.emit('change');
    }

    detach(name: string, store: ScriptStateStore) {
        this.scripts.get(name)?.stores.get(store)?.();
        if (this.scripts.get(name)?.stores.delete(store)) this.emit('change');
    }

    list(): ScriptInfo[] {
        return [...this.scripts].map(([name, { options, stores }]) => {
            const runs = [...stores.keys()].flatMap(s => s.runs());
            const queued = runs.filter(r => r.queued).length;
            return { name, mode: options.mode, limit: scriptLimit(options), running: runs.length - queued, queued, runs };
        });
    }

    cancelRun(name: string, runId: number, reason: string) {
        const { stores } = this.need(name);
        const error: Error[] = [];
        for (const store of stores.keys()) {
            try {
                return store.cancelRun(runId, reason);
            } catch (e) {
                error.push(e as Error);
            }
        }
        throw error.find(e => /queued/.test(e.message)) ?? new Error("That run no longer exists");
    }

    private need(name: string) {
        const s = this.scripts.get(name);
        if (!s) throw new Error(`No such script: ${name}`);
        return s;
    }
}
