import { makeAutoObservable } from 'mobx';

/**
 * One shared ticking source for all time displays. The interval only runs while something has
 * `retain()`ed it and it isn't paused; pausing (stale connection) freezes `now`.
 */
export class Clock {
    now: number;
    paused = false;
    private retainers = 0;
    private timer?: ReturnType<typeof setInterval>;

    constructor(private readonly source: () => number = Date.now, private readonly intervalMs = 1000) {
        this.now = source();
        makeAutoObservable<Clock, any>(this, { source: false, intervalMs: false, timer: false, retainers: false }, { autoBind: true });
    }

    /** Start (shared) ticking; returns an idempotent release function. */
    retain(): () => void {
        this.retainers++;
        this.sync();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.retainers--;
            this.sync();
        };
    }

    setPaused(paused: boolean) {
        if (this.paused === paused) return;
        this.paused = paused;
        if (!paused) this.tick();
        this.sync();
    }

    private tick() { this.now = this.source(); }

    private sync() {
        const should = this.retainers > 0 && !this.paused;
        if (should && !this.timer) {
            this.tick();
            this.timer = setInterval(this.tick, this.intervalMs);
        } else if (!should && this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}

/** App-wide clock; paused by `app.ts` while the connection is not live. */
export const sharedClock = new Clock();
