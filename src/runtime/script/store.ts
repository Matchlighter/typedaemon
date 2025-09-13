
import { Executor } from "../../runtime/regen_executor";
import { ResumableMethod } from "../resumable/resumable_method";

export interface ScriptOptions {
    /** Default: 'parallel' */
    mode: 'single' | 'restart' | 'queued' | 'parallel';
    mode_key?: (args: any[]) => string;
    /** When `mode: 'queued'` or `mode: 'parallel`, define the maximum number queued+running. Default: 20 */
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
        return this.configuration.limit ?? 20;
    }

    pendingScripts: ScriptQueueItem[] = [];
    runningScripts: ScriptQueueItem[] = [];

    trackPending(item: ScriptQueueItem) {
        this.pendingScripts.push(item);
    }

    trackRunning(script: ScriptQueueItem) {
        this.runningScripts.push(script);
    }

    cancelOldest() {
        const drop_item = this.pendingScripts.shift();
        drop_item?.cancel(new Error("The Script has been called again, aborting this previous run."));
    }

    refill() {
        if (!this.configuration) return;

        let running_limit = this.configuration.mode == "parallel" ? this.limit : 1;

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
