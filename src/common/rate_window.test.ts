import { SlidingWindowCounter } from "./rate_window";

describe("SlidingWindowCounter", () => {
    it("counts events within the window", () => {
        const c = new SlidingWindowCounter(1000);
        for (const t of [0, 100, 200, 300]) c.record(t);
        expect(c.count(300)).toBe(4);
        // The first event has left the window
        expect(c.count(1001)).toBe(3);
    });

    it("computes when the count drops", () => {
        const c = new SlidingWindowCounter(1000);
        for (const t of [0, 100, 200, 300]) c.record(t);
        expect(c.timeUntilAtMost(4, 300)).toBe(0);
        expect(c.timeUntilAtMost(3, 300)).toBe(700);
        expect(c.timeUntilAtMost(1, 300)).toBe(900);
        expect(c.count(300 + 900)).toBe(1);
    });
});
