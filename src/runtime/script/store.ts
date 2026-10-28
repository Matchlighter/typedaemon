
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

export class ScriptStateStore {
    constructor(readonly configuration: ScriptOptions) {
    }

    get total_count() {
        return this.runningScripts.length + this.pendingScripts.length;
    }

    get limit() {
        if (!this.configuration) return 0;
        if (this.configuration.mode === 'single') return 1;
        if (this.configuration.limit === false) return Infinity;
        return this.configuration.limit ?? (this.configuration.mode === 'restart' ? 1 : 20);
    }

    pendingScripts: ScriptQueueItem[] = [];
    runningScripts: ScriptQueueItem[] = [];

    trackPending(item: ScriptQueueItem) {
        this.pendingScripts.push(item);
    }

    trackRunning(script: ScriptQueueItem) {
        this.runningScripts.push(script);
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
            try {
                item.cancel(reason);
            } catch (ex) {
                logMessage("error", "Failed to cancel script run", ex);
            }
        }
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
        let idx = this.runningScripts.indexOf(script);
        if (idx > -1) {
            this.runningScripts.splice(idx, 1);
            this.refill();
        } else {
            idx = this.pendingScripts.indexOf(script);
            if (idx > -1) {
                this.pendingScripts.splice(idx, 1);
            }
        }
    }
}
