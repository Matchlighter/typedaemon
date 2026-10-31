import { action, makeObservable, observable, runInAction } from 'mobx';

/** Message of anything thrown (server rejections arrive as `Error`) */
export const errorMessage = (e: unknown): string => String((e as Error)?.message ?? e);

export interface ConfirmedActionSpec<T> {
    /** The work; a rejection becomes `error` */
    call: (target: T) => Promise<unknown>;
    /** Text of `error` for a rejection with `message`. Default: the message itself */
    failure?: (target: T, message: string) => string;
    /** Runs after a successful call */
    done?: (target: T) => void;
    /** Close the confirmation as the call starts, not when it ends (default: it stays open, with the work in flight) */
    closeOnConfirm?: boolean;
}

/**
 * The confirm -> call -> report-failure flow of one destructive (or just fallible) action. `request` opens the
 * confirmation for a target, `confirm` runs it; `run` skips the confirmation. Render `confirming` in a `ConfirmDialog`
 * and `error` in an `ActionError`; `busy` while the call is in flight.
 */
export class ConfirmedAction<T> {
    confirming: T | undefined = undefined;
    busy = false;
    /** The target of the call in flight, if any */
    running: T | undefined = undefined;
    error: string | undefined = undefined;

    constructor(private spec: ConfirmedActionSpec<T>) {
        makeObservable(this, { confirming: observable.ref, busy: observable, running: observable.ref, error: observable, request: action, cancel: action, dismiss: action });
    }

    request(target: T) { this.confirming = target }
    cancel() { this.confirming = undefined }
    dismiss() { this.error = undefined }

    /** Run what `request` asked for */
    async confirm() {
        const target = this.confirming;
        if (target !== undefined) await this.run(target);
    }

    /** Run now, no confirmation */
    async run(target: T) {
        const { call, failure, done, closeOnConfirm } = this.spec;
        runInAction(() => { this.busy = true; this.running = target; this.error = undefined; if (closeOnConfirm) this.confirming = undefined });
        try {
            await call(target);
            done?.(target);
        } catch (e) {
            runInAction(() => { this.error = failure ? failure(target, errorMessage(e)) : errorMessage(e) });
        } finally {
            runInAction(() => { this.busy = false; this.running = undefined; this.confirming = undefined });
        }
    }
}
