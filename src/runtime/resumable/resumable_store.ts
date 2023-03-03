import { timeoutPromise } from "../../common/util";
import { ResumableOwnerLookup, resumable } from "./resumable_method";
import { ResumablePromise, Suspend } from "./resumable_promise";

export class ResumableStore {
    async resume(serialized: any, lookup?: ResumableOwnerLookup) {
        if (lookup) {
            return resumable.with_lookup_context(lookup, () => ResumablePromise.resumePromises(serialized));
        } else {
            return ResumablePromise.resumePromises(serialized);
        }
    }

    private state: 'active' | 'shutdown_requested' | 'suspending' | 'suspended' = 'active';

    private suspendedResumables = [];
    private onNonSuspendableClear: () => void;

    protected running_resumables = new Set<ResumablePromise<any>>();

    track(promise: ResumablePromise<any>) {
        if (this.state == "suspended") throw new Error("ResumableStore is suspended and not accepting new promises");

        if (this.state == 'suspending' && promise.treeCanSuspend()) {
            this.suspendedResumables.push(promise);
            return;
        }

        this.running_resumables.add(promise);

        promise.catch(
            (err) => {
                if (err instanceof Suspend) {
                    this.suspendedResumables.push(promise);
                    err.ack();
                }
                throw err;
            },
            true
        ).finally(() => {
            this.running_resumables.delete(promise);
            if (this.state == 'shutdown_requested') {
                for (let p of this.running_resumables) {
                    if (!p.treeCanSuspend()) return;
                }

                // All promises suspendable!
                this.onNonSuspendableClear();
            }
        })

        if (this.state == 'suspending') {
            promise.suspend();
        }
    }

    async suspendAndStore({ timeout }: { timeout: number } = { timeout: 10 }) {
        this.state = 'shutdown_requested';

        // Wait for pending non-suspendable HA await conditions to resolve
        const flushPromise = new Promise((accept) => {
            this.onNonSuspendableClear = accept as any;
            const hasNonSuspendable = [...this.running_resumables].some(o => !o.treeCanSuspend());
            if (!hasNonSuspendable) {
                this.onNonSuspendableClear();
            }
        });

        await timeoutPromise(timeout * 1000, flushPromise, () => {
            console.warn("ResumablePromises failed to resolve. Force Suspending.");
        })

        this.state = 'suspending';

        // Throw Suspend to all pending suspendable HA await conditions
        await Promise.all([...this.running_resumables].map(rr => rr.suspend()))

        /* Edge Case: Deferred awaiting
        {
            const x = some_promise();
            await some_resumable_promise();
            await x;
        }

        Line 2 should be recognized as not Suspendable.
        Case is solved - x is not serializable
        */

        // TODO Assert all items are suspended (promise rejected) by now

        this.state = 'suspended';

        // Serialize and return
        return ResumablePromise.serialize_all(this.suspendedResumables);
    }
}