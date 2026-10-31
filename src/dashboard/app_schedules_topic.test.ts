import { appSchedulesTopic, type AppSchedulesSource } from './app_schedules_topic';
import type { ScheduleRow } from './protocol';

const row = (key: string, over: Partial<ScheduleRow> = {}): ScheduleRow => ({ key, expression: "run_every('5m')", kind: 'interval', method: 'poll', ...over });

function setup(initial: ScheduleRow[] | null = [row('1')]) {
    let cb: (() => void) | undefined;
    let current = initial ?? undefined;
    const source: AppSchedulesSource = { list: () => current, onChange: (_id, f) => { cb = f; return () => { cb = undefined } } };
    return { topic: appSchedulesTopic(source), fire: () => cb?.(), set: (r: ScheduleRow[]) => { current = r }, subscribed: () => !!cb };
}

describe('appSchedules topic', () => {
    it('snapshots the schedules of the requested app', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ rows: [row('1')] });
    });

    it('rejects unknown apps', async () => {
        await expect(setup(null).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits fired/armed rows as upserts and gone ones as removals', () => {
        const { topic, fire, set } = setup([row('1'), row('2')]);
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        set([row('2', { lastAt: 9, lastResult: 'ok', nextAt: 20 }), row('3')]);
        fire();
        expect(emitted).toEqual([{ upsert: [row('2', { lastAt: 9, lastResult: 'ok', nextAt: 20 }), row('3')], remove: ['1'] }]);
    });

    it('stays quiet when nothing changed, and stops after unsubscribe', () => {
        const { topic, fire, subscribed } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe({ id: 'x' }, d => emitted.push(d));
        fire();
        expect(emitted).toEqual([]);
        off();
        expect(subscribed()).toBe(false);
    });
});
