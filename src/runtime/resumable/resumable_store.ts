import * as fs from 'fs';
import { TypedEmitter } from 'tiny-typed-emitter';

import { Batcher } from '../../common/batched';
import { fileExists, timeoutPromise } from "../../common/util";
import { logPluginClientMessage } from "../../hypervisor/logging";
import { ResumableOwnerLookup, resumable } from "./resumable_method";
import { objectId } from "../../common/object_id";
import { CancellableResumablePromise, FailedResume, ResumablePromise, SettledPromise, type ResumableDescription } from "./resumable_promise";

/** A user-visible resumable of the store. `id` is unique for the lifetime of the process (never reused by another store) */
export interface ResumableInfo extends ResumableDescription {
    id: number;
    status: 'running' | 'suspended' | 'failed';
}

interface TrackerEntry {
    resumable: ResumablePromise;
    tracking_callbacks: Promise<any>;
}

/** Suspended resumables, written by ResumableStore */
export const RESUMABLE_STATE_FILE = ".resumable_state.json";

/** A resumable that was given up on at shutdown because it didn't reach a point where it could be persisted; it won't be resumed */
export interface SuspendFailure {
    /** Set for user-visible resumables (see `ResumablePromise.describe`) */
    resumable?: ResumableDescription;
    error: SuspendFailedError;
}

export interface SaveResult {
    failed: SuspendFailure[];
}

export class SuspendFailedError extends Error {
    name = "SuspendFailedError";
}

interface StoreOptions {
    file: string,
}

export class ResumableStore extends TypedEmitter<{
    /** The list of user-visible resumables (or what one waits on) may have changed */
    change: () => void;
}> {
    constructor(readonly opts: StoreOptions, readonly context: ResumableOwnerLookup) {
        super();
    }

    get store_file() {
        return this.opts.file;
    }

    /** Resume what a previous run suspended. Returns the user-visible resumables that resumed (failed ones stay persisted and are not included) */
    async load(): Promise<ResumableInfo[]> {
        if (!await fileExists(this.store_file)) return [];

        logPluginClientMessage("Resumable", "info", "Found stored Resumables; resuming them")
        const restore_json = await fs.promises.readFile(this.store_file);
        const restore_list = JSON.parse(restore_json.toString());
        if (!Array.isArray(restore_list)) {
            // Written by the old script manager; not ours to interpret, but don't destroy it
            const legacy = this.store_file + ".legacy";
            logPluginClientMessage("Resumable", "warn", `${this.store_file} is not in the expected format; moved to ${legacy}`);
            await fs.promises.rename(this.store_file, legacy);
            return [];
        }

        const loaded = await this._loadWithLookups(restore_list);
        const failures = Object.values(loaded).filter(p => p instanceof FailedResume) as FailedResume[];
        if (failures.length) {
            // TODO Add help link
            logPluginClientMessage("Resumable", 'error', `Failed to resume at least some resumables. Failed items will continue to be persisted and resumption will be re-attempted every time the app loads.`);
            for (let f of failures) {
                logPluginClientMessage("Resumable", 'error', f.error);
            }
        }

        await fs.promises.unlink(this.store_file)
        return this.list().filter(r => r.status !== 'failed');
    }

    /**
     * How long a shutdown waits for resumables to reach a point where they can be persisted (a running one keeps going
     *   until it does). Those that haven't by then are given up on: not persisted, and reported by `save()`.
     */
    static SUSPEND_TIMEOUT_MS = 5000;

    /** Suspend everything and persist what could be; the rest is reported as `failed` */
    async save(): Promise<SaveResult> {
        const { serialized, failed } = await this._suspendAndSerialize();
        if (serialized.length > 0) {
            await fs.promises.writeFile(this.store_file, JSON.stringify(serialized));
        }
        return { failed };
    }

    private _state: 'active' | 'shutdown_requested' | 'suspending' | 'suspended' = 'active';
    get state() { return this._state }

    private setState(state: ResumableStore['_state']) {
        this._state = state;
        this.emit('change');
    }

    /** The resumables worth showing a user (running, suspended by a shutdown, or failed to resume) */
    list(): ResumableInfo[] {
        const rows: ResumableInfo[] = [];
        for (const p of this.tracked_tasks.keys()) {
            const d = p.describe();
            if (!d) continue;
            const status = p instanceof FailedResume ? 'failed' : this._state !== 'active' && p.suspended ? 'suspended' : 'running';
            rows.push({ ...d, id: objectId(p), status });
        }
        return rows;
    }

    private find(id: number) {
        for (const p of this.tracked_tasks.keys()) {
            if (p.describe() && objectId(p) === id) return p;
        }
        throw new Error("That resumable no longer exists");
    }

    /** Stop a running resumable; it fails with a cancellation, as if it had been cancelled by its own code */
    cancel(id: number, reason: string) {
        const p = this.find(id);
        if (p instanceof FailedResume) throw new Error("A failed resume can't be cancelled; discard it instead");
        if (this._state !== 'active') throw new Error("The app is shutting down");
        if (!(p instanceof CancellableResumablePromise) || !p.isCancellable()) throw new Error("This resumable can't be cancelled");
        p.cancel(reason);
    }

    /** Give up on a failed resume: it (and failures that only wait on it) stops being persisted, so it is not retried at the next start */
    discard(id: number) {
        const p = this.find(id);
        if (!(p instanceof FailedResume)) throw new Error("This resumable has not failed");
        if (this._state !== 'active') throw new Error("The app is shutting down");
        // Collect before rejecting: settled dependencies are swapped out of the dependents' lists
        const doomed = new Set<FailedResume>([p]);
        for (let grew = true; grew;) {
            grew = false;
            for (const t of this.tracked_tasks.keys()) {
                if (t instanceof FailedResume && !doomed.has(t) && t.dependencies.some(d => d instanceof FailedResume && doomed.has(d))) {
                    doomed.add(t);
                    grew = true;
                }
            }
        }
        doomed.forEach(f => f.discard());
    }

    private onNonSuspendableClear: () => void;

    protected tracked_tasks = new Map<ResumablePromise, TrackerEntry>();

    /** Number of resumables currently tracked (running or suspended) */
    get size() { return this.tracked_tasks.size }

    readonly computeBatcher = new Batcher(() => {
        this.checkAllSuspended();
    })

    track(promise: ResumablePromise<any>) {
        if (promise instanceof SettledPromise) return;

        if (this._state == "suspended") throw new Error("ResumableStore is suspended and not accepting new promises");

        if (this.tracked_tasks.has(promise)) return;

        const untrack = () => {
            this.tracked_tasks.delete(promise);
            this.checkAllSuspended();
            this.emit('change');
        }
        // NB: Not `finally()` - that re-throws rejections into a Promise nobody handles
        const track_promise = promise.then(untrack, untrack, true);

        this.tracked_tasks.set(promise, {
            resumable: promise,
            tracking_callbacks: track_promise,
        })
        this.announceTracked();
    }

    private announcePending = false;
    /**
     * `track` runs from the `ResumablePromise` constructor, before the subclass (and whoever called `new`, eg
     * `@resumable` setting `scope`) has finished setting it up. Listeners (`list()`) must not see it half-built, so
     * new entries are announced once the current synchronous work is done; a burst of them is one `change`.
     */
    private announceTracked() {
        if (this.announcePending) return;
        this.announcePending = true;
        queueMicrotask(() => {
            this.announcePending = false;
            this.emit('change');
        });
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

    private async _loadWithLookups(serialized: any) {
        const lookup = this.context;
        if (lookup) {
            return resumable.with_lookup_context(lookup, () => ResumablePromise.resumePromises(serialized));
        } else {
            return ResumablePromise.resumePromises(serialized);
        }
    }

    private async _suspendAndSerialize() {
        this.setState('shutdown_requested');
        logPluginClientMessage("Resumable", "debug", "Shutting down resumables")

        this.computeBatcher.perform(() => {
            for (let rp of this.tracked_tasks.keys()) {
                rp.compute_paused();
            }
        })

        // Wait for everything to suspend: whatever can't yet (eg. it holds something unpersistable, or waits on a plain
        //   Promise) keeps running, and may get to a point where it can, or finish.
        const flushPromise = new Promise((accept) => {
            this.onNonSuspendableClear = accept as any;
            const hasNonSuspendable = [...this.tracked_tasks.keys()].some(o => !o.suspended);
            if (!hasNonSuspendable) {
                this.onNonSuspendableClear();
            }
        });

        await timeoutPromise(ResumableStore.SUSPEND_TIMEOUT_MS, flushPromise, () => {
            logPluginClientMessage("Resumable", "warn", "Some resumables did not suspend in time; giving up on them.")
        })

        this.setState('suspending');
        const failed = this.giveUpOnUnsuspended();

        this.setState('suspended');
        logPluginClientMessage("Resumable", "debug", "Resumables suspended")

        // Serialize and return. What was given up on (force-suspended) is persisted as a rejection, if anything persisted depends on it
        return { serialized: ResumablePromise.serialize_all(this.allForSerializing()), failed };
    }

    /** Force-suspend whatever didn't suspend in time, reporting those that are why (not those just waiting on another to suspend) */
    private giveUpOnUnsuspended(): SuspendFailure[] {
        const stuck = [...this.tracked_tasks.keys()].filter(p => !p.suspended);

        // Before forcing: a forced one counts as suspended
        const failed: SuspendFailure[] = [];
        for (const p of stuck) {
            const reason = p.suspendBlocker();
            if (!reason) continue;
            const resumable = p.describe();
            const what = resumable ? `${resumable.type === 'script' ? 'Script' : '@resumable'} ${resumable.owner}.${resumable.method}` : p.constructor.name;
            failed.push({ resumable, error: new SuspendFailedError(`${what} could not be suspended, so it will not be resumed: ${reason}`) });
        }

        for (const p of stuck) p.force_suspend();
        for (const p of stuck) {
            if (!p.suspended) console.log("NOT SUSPENDED:", p);
        }

        for (const f of failed) {
            logPluginClientMessage("Resumable", "error", f.error.message);
        }
        return failed;
    }

    private *allForSerializing() {
        for (let task of this.tracked_tasks.values()) {
            yield task.resumable;
        }
    }
}