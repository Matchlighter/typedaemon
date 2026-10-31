import { autorun } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from './clock';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe('Clock', () => {
    it('does not run a timer until retained; one timer for many retainers', () => {
        const c = new Clock();
        expect(vi.getTimerCount()).toBe(0);
        const a = c.retain(), b = c.retain();
        expect(vi.getTimerCount()).toBe(1);
        a();
        expect(vi.getTimerCount()).toBe(1);
        b();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ticks `now` every second and notifies observers', () => {
        const c = new Clock();
        const seen: number[] = [];
        const stop = autorun(() => seen.push(c.now));
        const release = c.retain();
        vi.advanceTimersByTime(2000);
        expect(seen.length).toBe(3);
        expect(c.now).toBe(1_002_000);
        release(); stop();
    });

    it('release is idempotent', () => {
        const c = new Clock();
        const a = c.retain(); c.retain();
        a(); a();
        expect(vi.getTimerCount()).toBe(1);
    });

    it('pausing freezes now and stops the timer; resuming catches up', () => {
        const c = new Clock();
        c.retain();
        c.setPaused(true);
        expect(vi.getTimerCount()).toBe(0);
        const frozen = c.now;
        vi.advanceTimersByTime(5000);
        expect(c.now).toBe(frozen);
        c.setPaused(false);
        expect(c.now).toBe(1_005_000);
        expect(vi.getTimerCount()).toBe(1);
    });
});
