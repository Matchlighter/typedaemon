import { logsTopic, type LogsSource } from './logs_topic';
import type { LogRow } from './protocol';

const row = (id: number, over: Partial<LogRow> = {}): LogRow => ({ id, ts: id, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: `m${id}`, ...over });

function setup(history: LogRow[] = [row(1), row(2)]) {
    let push: ((r: LogRow) => void) | undefined;
    const calls: any[] = [];
    const source: LogsSource = {
        history: p => { calls.push(['history', p]); return history },
        onAppend: (p, cb) => { calls.push(['on', p]); push = cb; return () => { push = undefined } },
    };
    return { topic: logsTopic(source, { flushMs: 50 }), push: (r: LogRow) => push?.(r), subscribed: () => !!push, calls };
}

describe('logs topic', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('snapshots history for the requested sources and limit', async () => {
        const { topic, calls } = setup();
        const params = { sources: [{ kind: 'app', id: 'a' } as const], limit: 5 };
        expect(await topic.snapshot(params)).toEqual({ entries: [row(1), row(2)] });
        expect(calls).toEqual([['history', params]]);
    });

    it('batches new lines into one append per flush interval, in order', () => {
        const { topic, push } = setup();
        const emitted: any[] = [];
        topic.subscribe({}, d => emitted.push(d));
        push(row(3)); push(row(4));
        expect(emitted).toEqual([]);
        jest.advanceTimersByTime(50);
        expect(emitted).toEqual([{ append: [row(3), row(4)] }]);
        push(row(5));
        jest.advanceTimersByTime(50);
        expect(emitted[1]).toEqual({ append: [row(5)] });
    });

    it('subscribes to the same sources, and drops pending lines and the feed on unsubscribe', () => {
        const { topic, push, subscribed, calls } = setup();
        const emitted: any[] = [];
        const params = { sources: [{ kind: 'system', id: 'hypervisor' } as const] };
        const off = topic.subscribe(params, d => emitted.push(d));
        expect(calls).toEqual([['on', params]]);
        push(row(3));
        off();
        jest.advanceTimersByTime(100);
        expect(emitted).toEqual([]);
        expect(subscribed()).toBe(false);
    });
});
