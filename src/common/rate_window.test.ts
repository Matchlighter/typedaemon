import { SlidingWindowLimiter } from "./rate_window";

describe("SlidingWindowLimiter", () => {
    it("allows `count` events per window", () => {
        const l = new SlidingWindowLimiter(3, 1000);
        expect([0, 100, 200, 300].map(t => l.tryAcquire(t))).toEqual([true, true, true, false]);
        // The first event has left the window
        expect(l.tryAcquire(1001)).toBe(true);
        expect(l.tryAcquire(1002)).toBe(false);
    });
});
