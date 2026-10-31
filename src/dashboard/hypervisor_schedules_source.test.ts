import type { AppSchedulesSource } from './app_schedules_topic';
import { hypervisorSchedulesSource, type SchedulesHost } from './hypervisor_schedules_source';
import type { ScheduleRow } from './protocol';

const sched = (key: string, over: Partial<ScheduleRow> = {}): ScheduleRow => ({ key, expression: 'run_every(5m)', kind: 'interval', method: 'tick', ...over });

function setup(apps: Record<string, ScheduleRow[]>) {
    let cfgWatch: (() => void) | undefined;
    const listeners = new Map<string, () => void>();
    const host = {
        currentConfig: { apps: Object.fromEntries(Object.keys(apps).map(id => [id, {}])) },
        watchConfigEntry: (_k: string, cb: () => void) => { cfgWatch = cb; return () => { cfgWatch = undefined } },
    } as unknown as SchedulesHost;
    const per: AppSchedulesSource = {
        list: id => apps[id],
        onChange: (id, cb) => { listeners.set(id, cb); return () => { listeners.delete(id) } },
    };
    return { host, source: hypervisorSchedulesSource(host, per), listeners, apps, fireConfig: () => cfgWatch?.() };
}

describe('hypervisorSchedulesSource', () => {
    it('lists every app\'s schedules with app-qualified keys', () => {
        const { source } = setup({ a: [sched('1')], b: [sched('1', { method: 'other' })] });
        expect(source.list()).toEqual([
            { ...sched('1'), key: 'a/1', app: 'a' },
            { ...sched('1', { method: 'other' }), key: 'b/1', app: 'b' },
        ]);
    });

    it('follows per-app changes and apps joining/leaving the config; detaches on dispose', () => {
        const t = setup({ a: [] });
        const cb = jest.fn();
        const off = t.source.onChange(cb);
        expect([...t.listeners.keys()]).toEqual(['a']);
        t.listeners.get('a')!();
        expect(cb).toHaveBeenCalledTimes(1);
        t.apps.b = [];
        (t.host.currentConfig as any).apps = { a: {}, b: {} };
        t.fireConfig();
        expect([...t.listeners.keys()]).toEqual(['a', 'b']);
        expect(cb).toHaveBeenCalledTimes(2);
        (t.host.currentConfig as any).apps = { b: {} };
        t.fireConfig();
        expect([...t.listeners.keys()]).toEqual(['b']);
        off();
        expect(t.listeners.size).toBe(0);
    });
});
