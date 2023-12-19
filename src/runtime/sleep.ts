
import { current } from "../hypervisor/current";
import { ResumablePromise } from "./resumable";

class SleeperPromise extends ResumablePromise<number>{
    constructor(readonly sleep_until: number) {
        super();
        this.do_unsuspend();
    }

    private timer;
    private application = current.application;

    static {
        ResumablePromise.defineClass<SleeperPromise>({
            type: 'sleep',
            resumer: (data) => {
                return new this(data.sleep_until);
            },
        })
    }

    protected do_suspend(): void {
        this.clearTimeout();
    }

    protected do_unsuspend(): void {
        const sleep_until = this.sleep_until;
        const sleep_time = sleep_until - Date.now();
        const _setTimeout: typeof setTimeout = this.application.unsafe_vm.sandbox.setTimeout;
        if (sleep_time > 0) {
            this.timer = _setTimeout(() => {
                this._resolve(Date.now() - sleep_until);
            }, sleep_time)
        } else {
            this._resolve(Date.now() - sleep_until);
        }
    }

    private clearTimeout() {
        if (this.timer){
            const _clearTimeout: typeof clearTimeout = this.application.unsafe_vm.sandbox.clearTimeout;
            _clearTimeout(this.timer);
        }
    }

    cancel() {
        this.clearTimeout();
        this._reject("CANCELLED");
    }

    serialize() {
        return {
            type: 'sleep',
            sideeffect_free: true,
            sleep_until: this.sleep_until,
        }
    }
}

export function sleep(time_ms: number) {
    return new SleeperPromise(Date.now() + time_ms);
}

export function sleep_until(u: Date) {
    return new SleeperPromise(u.getTime());
}
