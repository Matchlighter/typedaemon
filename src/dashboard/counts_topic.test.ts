import { countsTopic, type CountSource } from './counts_topic';

function setup(initial = 2) {
    let cb: (() => void) | undefined;
    let n = initial;
    const sources: Record<string, CountSource> = {
        entities: { count: async () => n, onChange: f => { cb = f; return () => { cb = undefined } } },
        broken: { count: () => { throw new Error('x') }, onChange: () => () => { } },
    };
    return { topic: countsTopic(sources), fire: () => cb?.(), set: (v: number) => { n = v }, subscribed: () => !!cb };
}
const flush = () => new Promise(r => setImmediate(r));

describe('counts topic', () => {
    it('snapshots totals, omitting failed ones', async () => {
        expect(await setup(3).topic.snapshot(undefined)).toEqual({ entities: 3 });
    });

    it('emits the fresh snapshot only when a total changed', async () => {
        const { topic, fire, set } = setup();
        const emitted: any[] = [];
        topic.subscribe(undefined, d => emitted.push(d));
        await flush();
        fire(); await flush();
        expect(emitted).toEqual([]);
        set(5); fire(); await flush();
        expect(emitted).toEqual([{ entities: 5 }]);
    });

    it('unsubscribes from sources on dispose', async () => {
        const { topic, subscribed } = setup();
        const off = topic.subscribe(undefined, () => { });
        expect(subscribed()).toBe(true);
        off();
        expect(subscribed()).toBe(false);
    });
});
