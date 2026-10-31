import { lifecycleTopic, type LifecycleSource } from './lifecycle_topic';
import type { LifecycleEvent } from './protocol';

const ev = (id: number): LifecycleEvent => ({ id, ts: id, app: 'a', name: 'a', state: 'started' });

function setup(initial: LifecycleEvent[] = []) {
    let cb: (e: LifecycleEvent) => void = () => { };
    const off = jest.fn();
    const source: LifecycleSource = { recent: () => initial, onEvent: c => { cb = c; return off } };
    return { source, push: (e: LifecycleEvent) => cb(e), off };
}

describe('lifecycle topic', () => {
    it('snapshot is the recent events', async () => {
        const t = setup([ev(1), ev(2)]);
        expect(await lifecycleTopic(t.source).snapshot(undefined)).toEqual({ events: [ev(1), ev(2)] });
    });

    it('appends each new event as a delta and detaches on unsubscribe', () => {
        const t = setup();
        const emit = jest.fn();
        const unsub = lifecycleTopic(t.source).subscribe(undefined, emit);
        t.push(ev(3));
        expect(emit).toHaveBeenCalledWith({ append: [ev(3)] });
        unsub();
        expect(t.off).toHaveBeenCalled();
    });
});
