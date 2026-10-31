import type { GlobalScheduleRow } from './protocol';
import { schedulesTopic, type SchedulesSource } from './schedules_topic';

const row = (app: string, key: string, over: Partial<GlobalScheduleRow> = {}): GlobalScheduleRow =>
    ({ key: `${app}/${key}`, app, expression: 'run_every(5m)', kind: 'interval', method: 'tick', ...over });
const flush = () => new Promise(r => setImmediate(r));

describe('schedules topic', () => {
    it('snapshots the schedules and emits a keyed delta when one fires', async () => {
        let cb: (() => void) | undefined;
        let current = [row('a', '1', { nextAt: 10 }), row('b', '2')];
        const source: SchedulesSource = { list: () => current, onChange: f => { cb = f; return () => { cb = undefined } } };
        const topic = schedulesTopic(source);
        const emitted: any[] = [];
        topic.subscribe(undefined, d => emitted.push(d));
        expect(await topic.snapshot(undefined)).toEqual({ rows: current });
        current = [row('a', '1', { nextAt: 20 }), row('b', '2')];
        cb!(); await flush();
        expect(emitted).toEqual([{ upsert: [row('a', '1', { nextAt: 20 })] }]);
    });
});
