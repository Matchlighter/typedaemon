import { orphanTopic, type OrphanSource } from './orphan_topic';

function setup() {
    let cb: () => void;
    let current: any = { id: 'x' };
    const source: OrphanSource = { get: async () => current, cleanup: async () => { }, onChange: (_id, f) => { cb = f; return () => { cb = undefined } } };
    return { topic: orphanTopic(source), fire: () => cb?.(), set: (v: any) => { current = v } };
}

describe('orphan topic', () => {
    it('snapshots what the source knows, also when there are no leftovers', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ id: 'x' });
    });

    it('emits the full, fresh snapshot on every change, and nothing after unsubscribe', async () => {
        const t = setup();
        const emitted: any[] = [];
        const off = t.topic.subscribe({ id: 'x' }, d => emitted.push(d));
        t.set({ id: 'x', leftovers: {} });
        t.fire();
        await new Promise(r => setImmediate(r));
        expect(emitted).toEqual([{ id: 'x', leftovers: {} }]);
        off();
        t.fire();
        expect(emitted).toHaveLength(1);
    });
});
