import type { SystemFacts, SystemSource } from './system_topic';
import { systemTopic } from './system_topic';

const INFO = { version: 'v1', nodeVersion: '22.11.0', startedAt: 500 };
const facts = (over: Partial<SystemFacts> = {}): SystemFacts => ({ state: 'running', crossCalls: [], ...over });

function setup() {
    let current = facts();
    let fire = () => { };
    const off = jest.fn();
    const get = jest.fn((stores: boolean): SystemFacts => stores ? { ...current, stores: [] } : current);
    const source: SystemSource = { get, onChange: cb => { fire = cb; return off } };
    return { source, get, off, set: (s: SystemFacts) => { current = s }, fire: () => fire() };
}

describe('system topic', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('snapshot carries version, startedAt, server now and the source facts', async () => {
        jest.setSystemTime(1_000_000);
        const t = setup();
        t.set(facts({ configPath: '/c.yaml' }));
        expect(await systemTopic(INFO, t.source).snapshot(undefined)).toEqual({ ...INFO, now: 1_000_000, ...facts({ configPath: '/c.yaml' }) });
    });

    it('stores are only read when params ask for them', async () => {
        const t = setup();
        const topic = systemTopic(INFO, t.source);
        expect(await topic.snapshot(undefined)).not.toHaveProperty('stores');
        expect(await topic.snapshot({ stores: true })).toHaveProperty('stores', []);
        expect(t.get).toHaveBeenLastCalledWith(true);
    });

    it('emits a now delta periodically until unsubscribed', () => {
        jest.setSystemTime(0);
        const emit = jest.fn();
        const off = systemTopic(INFO, setup().source, { intervalMs: 1000 }).subscribe(undefined, emit);
        jest.advanceTimersByTime(2000);
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ now: 2000 });
        off();
        jest.advanceTimersByTime(5000);
        expect(emit).toHaveBeenCalledTimes(2);
    });

    it('emits the full fresh snapshot on change, coalescing bursts', async () => {
        jest.setSystemTime(7);
        const t = setup();
        const emit = jest.fn();
        systemTopic(INFO, t.source, { coalesceMs: 100, intervalMs: 1e9 }).subscribe(undefined, emit);
        t.set(facts({ state: 'shutting_down' }));
        t.fire(); t.fire(); t.fire();
        expect(emit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(100);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith({ ...INFO, now: 107, ...facts({ state: 'shutting_down' }) });
    });

    it('does not resend facts identical to the last ones', async () => {
        const t = setup();
        const emit = jest.fn();
        systemTopic(INFO, t.source, { coalesceMs: 100, intervalMs: 1e9 }).subscribe(undefined, emit);
        await jest.advanceTimersByTimeAsync(0);
        t.fire();
        await jest.advanceTimersByTimeAsync(100);
        expect(emit).not.toHaveBeenCalled();
        t.set(facts({ state: 'shutting_down' }));
        t.fire();
        await jest.advanceTimersByTimeAsync(100);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('a stores subscription re-reads with stores on change', async () => {
        const t = setup();
        systemTopic(INFO, t.source, { coalesceMs: 100, intervalMs: 1e9 }).subscribe({ stores: true }, jest.fn());
        t.fire();
        await jest.advanceTimersByTimeAsync(100);
        expect(t.get).toHaveBeenCalledWith(true);
        expect(t.get).not.toHaveBeenCalledWith(false);
    });

    it('unsubscribing detaches and cancels pending work', async () => {
        const t = setup();
        const emit = jest.fn();
        const unsub = systemTopic(INFO, t.source, { coalesceMs: 100, intervalMs: 50 }).subscribe(undefined, emit);
        t.fire();
        unsub();
        await jest.advanceTimersByTimeAsync(500);
        expect(t.off).toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });
});
