import { ResumablePromise } from "../../runtime/resumable";

class SleeperPromise extends ResumablePromise<number>{
    constructor(readonly sleep_until: number) {
        super();
        this.do_unsuspend();
    }

    private timer;

    static {
        ResumablePromise.defineClass<SleeperPromise>({
            type: 'sleep',
            resumer: (data) => {
                return new this(data.sleep_until);
            },
        })
    }

    protected do_suspend(): void {
        if (this.timer) clearTimeout(this.timer);
    }

    protected do_unsuspend(): void {
        const sleep_until = this.sleep_until;
        const sleep_time = sleep_until - Date.now();
        if (sleep_time > 0) {
            this.timer = setTimeout(() => {
                this._resolve(Date.now() - sleep_until);
            }, sleep_time)
        } else {
            this._resolve(Date.now() - sleep_until);
        }
    }

    cancel() {
        if (this.timer) clearTimeout(this.timer);
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
