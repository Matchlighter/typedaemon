import fs = require('fs');

import { fileExists, timeoutPromise } from "../../common/util";
import { current } from "../../hypervisor/current";
import { ExtendedLoger, LogAMessage, LogLevel } from "../../hypervisor/logging";
import { ResumableOwnerLookup, resumable } from "./resumable_method";
import { FailedResume, ResumablePromise, Suspend } from "./resumable_promise";

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

    private failedLoads: FailedResume[] = [];

    get store_file() {
        return this.opts.file;
    }

    async load() {
        if (!await fileExists(this.store_file)) return;

        this.logMessage("info", "Found stored Resumables; resuming them")
        const restore_json = await fs.promises.readFile(this.store_file);
        const restore_list = JSON.parse(restore_json.toString());

        const { failures, loaded } = await this._loadWithLookups(restore_list);
        this.failedLoads = failures;
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

    private suspendedResumables = [];
    private onNonSuspendableClear: () => void;

    protected tracked_tasks = new Map<ResumablePromise, TrackerEntry>();

    track(promise: ResumablePromise<any>) {
        if (this._state == "suspended") throw new Error("ResumableStore is suspended and not accepting new promises");

        if (this.tracked_tasks.has(promise)) return;

        const track_promise = promise.catch(
            (err) => {
                if (err instanceof Suspend) {
                    this.suspendedResumables.push(promise);
                    err.ack();
                }
                throw err;
            },
            true
        ).finally(() => {
            this.tracked_tasks.delete(promise);
            if (this._state == 'shutdown_requested') {
                for (let task of this.tracked_tasks.values()) {
                    if (!task.resumable.suspended) return;
                }

                // All promises suspendable!
                this.onNonSuspendableClear();
            }
        })

        this.tracked_tasks.set(promise, {
            resumable: promise,
            tracking_callbacks: track_promise,
        })
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

        for (let rp of track_states) {
            rp.resumable.compute_paused();
        }

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

        // Force suspend unsuspended Resumables
        for (let state of track_states) {
            if (!state.resumable.suspended) state.resumable.force_suspend();
        }

        await timeoutPromise(5000, Promise.allSettled(track_states.map(s => s.tracking_callbacks)), () => {
            this.logMessage("warn", "Resumable - Some Resumables still would not suspend.")
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
        yield* this.suspendedResumables;
        yield* this.failedLoads;
    }
}