import { EventEmitter } from 'events';
import { ScheduleRegistry } from '../runtime/schedule/registry';
import { appScheduleCounts, hypervisorAppSchedulesSource, type AppSchedulesHost } from './hypervisor_app_schedules_source';

function setup(opts: { configured?: string[]; apps?: string[] } = {}) {
    const lifecycle = new EventEmitter();
    const apps: Record<string, any> = {};
    for (const id of opts.apps ?? []) apps[id] = { id, schedules: new ScheduleRegistry() };
    const host = {
        currentConfig: { apps: Object.fromEntries((opts.configured ?? Object.keys(apps)).map(id => [id, {}])) },
        listApplications: () => Object.values(apps),
        getApplication: (id: string) => apps[id],
        on: (e: string, cb: any) => lifecycle.on(e, cb),
        off: (e: string, cb: any) => lifecycle.off(e, cb),
    } as unknown as AppSchedulesHost;
    return { host, source: hypervisorAppSchedulesSource(host), lifecycle, apps };
}

describe('hypervisorAppSchedulesSource.list', () => {
    it('maps registered schedules to rows keyed by id', () => {
        const { source, apps } = setup({ apps: ['a'] });
        const s = apps.a.schedules.add({ expression: 'sunset-0:30', kind: 'sun', method: 'lights_on' });
        s.armed(new Date(50));
        s.fired('ok');
        expect(source.list('a')).toEqual([{ key: '1', expression: 'sunset-0:30', kind: 'sun', method: 'lights_on', nextAt: 50, lastAt: expect.any(Number), lastResult: 'ok' }]);
    });

    it('has no rows for a configured app without an instance, and knows nothing of other apps', () => {
        const { source } = setup({ configured: ['a'], apps: [] });
        expect(source.list('a')).toEqual([]);
        expect(source.list('zzz')).toBeUndefined();
    });
});

describe('hypervisorAppSchedulesSource.onChange', () => {
    it('fires when the schedules change', () => {
        const { source, apps } = setup({ apps: ['a'] });
        const cb = jest.fn();
        const off = source.onChange('a', cb);
        const s = apps.a.schedules.add({ expression: 'x', kind: 'cron', method: 'm' });
        s.armed(new Date(1));
        expect(cb).toHaveBeenCalledTimes(2);
        off();
        s.fired('ok');
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('follows the app onto its next instance', () => {
        const { source, apps, lifecycle } = setup({ apps: ['a'] });
        const cb = jest.fn();
        source.onChange('a', cb);
        const next = { id: 'a', schedules: new ScheduleRegistry() };
        lifecycle.emit('app_lifecycle', next);
        expect(cb).toHaveBeenCalledTimes(1);
        next.schedules.add({ expression: 'x', kind: 'cron', method: 'm' });
        expect(cb).toHaveBeenCalledTimes(2);
        apps.a.schedules.add({ expression: 'old', kind: 'cron', method: 'm' });
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('ignores other apps lifecycle', () => {
        const { source, lifecycle } = setup({ apps: ['a'] });
        const cb = jest.fn();
        source.onChange('a', cb);
        lifecycle.emit('app_lifecycle', { id: 'b', schedules: new ScheduleRegistry() });
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('appScheduleCounts', () => {
    it('counts registered schedules', () => {
        const reg = new ScheduleRegistry();
        reg.add({ expression: 'x', kind: 'cron', method: 'm' });
        expect(appScheduleCounts({ schedules: reg })).toEqual({ schedules: 1 });
    });
});
