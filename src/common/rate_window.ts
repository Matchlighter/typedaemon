
/**
 * Count events within a sliding `window` (ms)
 */
export class SlidingWindowCounter {
    constructor(readonly window: number) { }

    private events: number[] = [];

    private prune(now: number) {
        this.events = this.events.filter(t => t > now - this.window);
    }

    record(now = Date.now()) {
        this.prune(now);
        this.events.push(now);
    }

    count(now = Date.now()) {
        this.prune(now);
        return this.events.length;
    }

    /** Time (ms) until at most `n` events remain in the window, assuming no new events */
    timeUntilAtMost(n: number, now = Date.now()) {
        this.prune(now);
        if (this.events.length <= n) return 0;
        return this.events[this.events.length - n - 1] + this.window - now;
    }
}
