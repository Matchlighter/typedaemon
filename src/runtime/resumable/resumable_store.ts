import fs = require('fs');

import { Batcher } from '../../common/batched';
import { fileExists, timeoutPromise } from "../../common/util";
import { ExtendedLoger, LogLevel } from "../../hypervisor/logging";
import { ResumableOwnerLookup, resumable } from "./resumable_method";
import { FailedResume, ResumablePromise, SettledPromise } from "./resumable_promise";

interface TrackerEntry {
    resumable: ResumablePromise;
    tracking_callbacks: Promise<any>;
}

interface StoreOptions {
    file: string,
    logger: ExtendedLoger;
}

export class ResumableStore {
    constructor(readonly opts: StoreOptions, readonly context: ResumableOwnerLookup) {

    }

    get store_file() {
        return this.opts.file;
    }

    async load() {
        if (!await fileExists(this.store_file)) return;

        this.logMessage("info", "Found stored Resumables; resuming them")
        const restore_json = await fs.promises.readFile(this.store_file);
        const restore_list = JSON.parse(restore_json.toString());

        const loaded = await this._loadWithLookups(restore_list);
        const failures = Object.values(loaded).filter(p => p instanceof FailedResume) as FailedResume[];
        if (failures.length) {
            // TODO Add help link
            this.logMessage('error', `Failed to resume at least some resumables. Failed items will continue to be persisted and resumption will be re-attempted every time the app loads.`);
            for (let f of failures) {
                this.logMessage('error', f.error);
            }
        }

        await fs.promises.unlink(this.store_file)
    }

    async save() {
        const suspendeds = await this._suspendAndSerialize({});
        if (suspendeds.length > 0) {
            await fs.promises.writeFile(this.store_file, JSON.stringify(suspendeds));
        }
    }

    private _state: 'active' | 'shutdown_requested' | 'suspending' | 'suspended' = 'active';
    get state() { return this._state }

    private onNonSuspendableClear: () => void;

    protected tracked_tasks = new Map<ResumablePromise, TrackerEntry>();

    readonly computeBatcher = new Batcher(() => {
        this.checkAllSuspended();
    })

    track(promise: ResumablePromise<any>) {
        if (promise instanceof SettledPromise) return;

        if (this._state == "suspended") throw new Error("ResumableStore is suspended and not accepting new promises");

        if (this.tracked_tasks.has(promise)) return;

        const track_promise = promise.finally(() => {
            this.tracked_tasks.delete(promise);
            this.checkAllSuspended();
        }, true);

        this.tracked_tasks.set(promise, {
            resumable: promise,
            tracking_callbacks: track_promise,
        })
    }

    private checkAllSuspended() {
        if (this._state == 'active') return;

        if (this.onNonSuspendableClear) {
            let all_suspended = true;
            for (let task of this.tracked_tasks.values()) {
                if (!task.resumable.suspended) {
                    all_suspended = false;
                    break;
                }
            }
            if (all_suspended) {
                this.onNonSuspendableClear?.();
            }
        }
    }

    protected logMessage(level: LogLevel, ...rest) {
        this.opts.logger.logMessage(level, rest);
    }

    private async _loadWithLookups(serialized: any) {
        const lookup = this.context;
        if (lookup) {
            return resumable.with_lookup_context(lookup, () => ResumablePromise.resumePromises(serialized));
        } else {
            return ResumablePromise.resumePromises(serialized);
        }
    }

    private async _suspendAndSerialize({ timeout = 5 }: { timeout?: number } = {}) {
        this._state = 'shutdown_requested';
        this.logMessage("debug", "Resumable - shutting down resumables")

        const track_states = [...this.tracked_tasks.values()];

        this.computeBatcher.perform(() => {
            for (let rp of track_states) {
                rp.resumable.compute_paused();
            }
        })

        // Wait for pending non-suspendable promises to resolve
        const flushPromise = new Promise((accept) => {
            this.onNonSuspendableClear = accept as any;
            const hasNonSuspendable = [...this.tracked_tasks.keys()].some(o => !o.suspended);
            if (!hasNonSuspendable) {
                this.onNonSuspendableClear();
            }
        });

        await timeoutPromise(timeout * 1000, flushPromise, () => {
            this.logMessage("warn", "Resumable - ResumablePromises failed to resolve. Force Suspending.")
        })

        this._state = 'suspending';
        this.logMessage("debug", "Resumable - suspending remaining resumables")

        // Force cleanup unsuspended Resumables
        for (let state of track_states) {
            if (!state.resumable.suspended) {
                state.resumable.force_suspend();
            }
        }

        await timeoutPromise(5000, flushPromise, () => {
            this.logMessage("warn", "Resumable - Some Resumables still would not suspend.")
            for (let state of track_states) {
                if (!state.resumable.suspended) {
                    console.log("NOT SUSPENDED:", state.resumable)
                }
            }
        });

        /* Edge Case: Deferred awaiting
        {
            const x = some_promise();
            await some_resumable_promise();
            await x;
        }

        Line 2 should be recognized as not Suspendable.
        Case is solved - x is not serializable
        */

        this._state = 'suspended';
        this.logMessage("debug", "Resumable - resumables suspended")

        // Serialize and return
        return ResumablePromise.serialize_all(this.allForSerializing());
    }

    private *allForSerializing() {
        for (let task of this.tracked_tasks.values()) {
            yield task.resumable;
        }
    }
}