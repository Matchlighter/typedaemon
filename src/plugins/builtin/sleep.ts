import { ResumablePromise, SerializedResumable } from "../../runtime/resumable";

class SleeperPromise extends ResumablePromise<number>{
    constructor(readonly sleep_until: number) {
        super();

        const sleep_time = sleep_until - Date.now();
        if (sleep_time > 0) {
            this.timer = setTimeout(() => {
                this._resolve(Date.now() - sleep_until);
            }, sleep_time)
        } else {
            this._resolve(Date.now() - sleep_until);
        }
    }

    private timer;

    static {
        ResumablePromise.defineClass({
            type: 'sleep',
            resumer: (data) => {
                return new this(data.sleep_until);
            },
        })
    }

    suspend() {
        if (this.timer) clearTimeout(this.timer);
        return super.suspend();
    }

    serialize(): SerializedResumable {
        return {
            type: 'sleep',
            sideeffect_free: true,
            sleep_until: this.sleep_until,
        }
    }
}

export function sleep(time: number) {
    return new SleeperPromise(Date.now() + time);
}
