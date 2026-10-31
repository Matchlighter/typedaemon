import { ScheduleRegistry } from './registry';

const def = (over: object = {}) => ({ expression: "run_every('5m')", kind: 'interval' as const, method: 'poll', ...over });

describe('ScheduleRegistry', () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_000_000) });
    afterEach(() => { jest.useRealTimers() });

    it('lists a schedule as soon as it is registered, with nothing pending or fired yet', () => {
        const reg = new ScheduleRegistry();
        reg.add(def());
        expect(reg.list()).toEqual([{ id: 1, expression: "run_every('5m')", kind: 'interval', method: 'poll' }]);
    });

    it('reports when it is armed for, then when it fired and how it went', () => {
        const reg = new ScheduleRegistry();
        const s = reg.add(def());
        s.armed(new Date(1_300_000));
        expect(reg.list()[0]).toMatchObject({ nextAt: 1_300_000 });

        jest.setSystemTime(1_300_000);
        s.fired('ok');
        s.armed(new Date(1_600_000));
        expect(reg.list()[0]).toMatchObject({ nextAt: 1_600_000, lastAt: 1_300_000, lastResult: 'ok' });

        s.fired('error', 42);
        s.armed(undefined);
        expect(reg.list()[0].lastDurationMs).toBe(42);
        const row = reg.list()[0];
        expect(row.lastResult).toBe('error');
        expect(row).not.toHaveProperty('nextAt');
    });

    it('announces every change, and nothing when the same thing is reported again', () => {
        const reg = new ScheduleRegistry();
        const changes = jest.fn();
        reg.on('change', changes);
        const s = reg.add(def());
        expect(changes).toHaveBeenCalledTimes(1);
        s.armed(new Date(5));
        s.armed(new Date(5));
        expect(changes).toHaveBeenCalledTimes(2);
        s.fired('ok');
        expect(changes).toHaveBeenCalledTimes(3);
        s.remove();
        s.remove();
        expect(changes).toHaveBeenCalledTimes(4);
        expect(reg.list()).toEqual([]);
    });

    it('lists in registration order with distinct ids', () => {
        const reg = new ScheduleRegistry();
        reg.add(def({ method: 'a' }));
        reg.add(def({ method: 'b' }));
        expect(reg.list().map(s => [s.id, s.method])).toEqual([[1, 'a'], [2, 'b']]);
    });
});
