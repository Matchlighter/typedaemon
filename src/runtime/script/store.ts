
import { TypedEmitter } from "tiny-typed-emitter";
import { objectId } from "../../common/object_id";
import { logMessage } from "../../hypervisor/logging";
import { Executor } from "../../runtime/regen_executor";
import { ResumableMethod } from "../resumable/resumable_method";

export interface ScriptOptions {
    /** Default: 'parallel' */
    mode: 'single' | 'restart' | 'queued' | 'parallel';
    mode_key?: (args: any[]) => string;
    /** When `mode: 'queued'` or `mode: 'parallel`, define the maximum number queued+running. Default: 20 (1 for `mode: 'restart'`: a new call cancels the oldest runs beyond it) */
    limit?: number | false;
    shutdown?: 'suspend' | 'kill' | 'wait';
    // TODO Direct debounce and throttle support?
}

export type ScriptQueueItem = Executor<any> | ResumableMethod<any>;

/** Most runs a script may have (running + queued); null for no limit */
export function scriptLimit(configuration: ScriptOptions | undefined): number | null {
    if (!configuration) return 0;
    if (configuration.mode === 'single') return 1;
    if (configuration.limit === false) return null;
    // 'restart' keeps only the newest run unless told otherwise
    return configuration.limit ?? (configuration.mode === 'restart' ? 1 : 20);
}

export interface ScriptRunInfo {
    /** Unique for the lifetime of the process */
    id: number;
    params: unknown[];
    /** epoch ms it was queued, or started if it is running */
    startedAt: number;
    queued: boolean;
}

export class ScriptStateStore extends TypedEmitter<{
    /** Runs were queued, started or finished */
    change: () => void;
}> {
    constructor(readonly configuration: ScriptOptions) {
        super();
    }

    private meta = new Map<ScriptQueueItem, { params?: unknown[]; startedAt: number }>();

    /** What is running or queued, oldest first */
    runs(): ScriptRunInfo[] {
        const info = (item: ScriptQueueItem, queued: boolean): ScriptRunInfo => {
            const m = this.meta.get(item);
            const params = m?.params ?? (item instanceof ResumableMethod ? item.scope.parameters : []);
            return { id: objectId(item), params, startedAt: m?.startedAt ?? Date.now(), queued };
        };
        return [...this.runningScripts.map(i => info(i, false)), ...this.pendingScripts.map(i => info(i, true))];
    }

    /** Stop a run that is running (a queued one has not started: nothing to stop yet) */
    cancelRun(id: number, reason: string) {
        const running = this.runningScripts.find(i => objectId(i) === id);
        if (running) return void running.cancel(reason);
        if (this.pendingScripts.some(i => objectId(i) === id)) throw new Error("That run is queued, not running");
        throw new Error("That run no longer exists");
    }

    get total_count() {
        return this.runningScripts.length + this.pendingScripts.length;
    }

    get limit() {
        return scriptLimit(this.configuration) ?? Infinity;
    }

    pendingScripts: ScriptQueueItem[] = [];
    runningScripts: ScriptQueueItem[] = [];

    trackPending(item: ScriptQueueItem, params?: unknown[]) {
        this.meta.set(item, { params, startedAt: Date.now() });
        this.pendingScripts.push(item);
        this.emit('change');
    }

    trackRunning(script: ScriptQueueItem) {
        const m = this.meta.get(script);
        // Resumed runs keep their original start
        if (m) m.startedAt = Date.now();
        else this.meta.set(script, { startedAt: Date.now() });
        this.runningScripts.push(script);
        this.emit('change');
    }

    /** Cancel queued (unstarted) runs. Their completion check-ins remove them from the queue. */
    cancelPending(reason?: any) {
        for (const item of [...this.pendingScripts]) {
            item.cancel(reason);
        }
    }

    /**
     * Cancel and stop tracking the oldest runs (running before queued) until a new run fits under `limit`,
     * so it may start immediately. Cancellation is cooperative: a cancelled run may outlive this call.
     */
    makeRoom(reason?: any) {
        const excess = this.total_count - this.limit + 1;
        if (excess <= 0) return;
        const items = [...this.runningScripts, ...this.pendingScripts].slice(0, excess);
        this.runningScripts = this.runningScripts.filter(i => !items.includes(i));
        this.pendingScripts = this.pendingScripts.filter(i => !items.includes(i));
        for (const item of items) {
            this.meta.delete(item);
            try {
                item.cancel(reason);
            } catch (ex) {
                logMessage("error", "Failed to cancel script run", ex);
            }
        }
        this.emit('change');
    }

    refill() {
        if (!this.configuration) return;

        // 'restart' with limit N keeps the N newest runs going at once
        let running_limit = this.configuration.mode == "parallel" || this.configuration.mode == "restart" ? this.limit : 1;

        while (this.runningScripts.length < running_limit && this.pendingScripts.length > 0) {
            const next = this.pendingScripts.shift();

            this.trackRunning(next);

            if (next instanceof ResumableMethod) {
                next.resume();
            } else {
                next.start();
            }
        }
    }

    checkin(script: ScriptQueueItem = null) {
        // Decrement script counter and clear cancel handler
        this.meta.delete(script);
        let idx = this.runningScripts.indexOf(script);
        if (idx > -1) {
            this.runningScripts.splice(idx, 1);
            this.emit('change');
            this.refill();
        } else {
            idx = this.pendingScripts.indexOf(script);
            if (idx > -1) {
                this.pendingScripts.splice(idx, 1);
                this.emit('change');
            }
        }
    }
}
