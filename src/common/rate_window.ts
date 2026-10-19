
/**
 * Allow at most `count` events per sliding `window` (ms)
 */
export class SlidingWindowLimiter {
    constructor(readonly count: number, readonly window: number) { }

    private events: number[] = [];

    /** Record an event if the limit allows it. Returns `false` (recording nothing) if the limit has been reached */
    tryAcquire(now = Date.now()) {
        this.events = this.events.filter(t => t > now - this.window);
        if (this.events.length >= this.count) return false;
        this.events.push(now);
        return true;
    }
}
