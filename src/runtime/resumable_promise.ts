
import { ExtensiblePromise } from "@matchlighter/common_library/cjs/promises"
import { runtime } from "./resumable_runtime";

export class Suspend extends Error {

}

let SER_UID_COUNTER = 1;

export abstract class ResumablePromise<T> extends ExtensiblePromise<T> {
    then<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        if (runtime._resumable_context) {
            this.resumable_awaiters.push(runtime._resumable_context);
        } else {
            this.suspendable = false;
        }

        return super.then(onfulfilled, onrejected);
    }

    private suspendable = true;
    private resumable_awaiters: ResumablePromise<any>[];

    // All awaiters must be ResumablePromises and themselves be ready to suspend
    can_suspend() {
        if (!this.suspendable) return false;
        for (let res of this.resumable_awaiters) {
            if (!res.can_suspend()) return false;
        }
        return true;
    }

    abstract serialize();

    private _uid;
    get uid() {
        if (!this._uid) {
            this._uid = SER_UID_COUNTER;
            SER_UID_COUNTER += 1;
        }
        return this._uid;
    }
}
