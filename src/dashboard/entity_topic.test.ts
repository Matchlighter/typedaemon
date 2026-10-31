import type { EntityDetail } from './protocol';
import { entityTopic, type EntitySource } from './entity_topic';

const detail = (state: string): EntityDetail => ({
    key: 'a/ha:x', entityKey: 'ha:x', app: 'a', plugin: 'ha', domain: 'sensor', entityId: 'sensor.x', state,
    linked: true, autoClean: false, persistState: false, attributes: { unit: 'W' },
});

function setup() {
    let cb: (() => void) | undefined;
    let current: EntityDetail | undefined = detail('1');
    const source: EntitySource = {
        get: async () => current,
        onChange: (_id, f) => { cb = f; return () => { cb = undefined } },
    };
    return { topic: entityTopic(source), fire: () => cb?.(), set: (d?: EntityDetail) => { current = d } };
}

describe('entity topic', () => {
    it('snapshots the entity detail', async () => {
        expect(await setup().topic.snapshot({ id: 'a/ha:x' })).toEqual(detail('1'));
    });

    it('rejects unknown entities', async () => {
        const { topic, set } = setup();
        set(undefined);
        await expect(topic.snapshot({ id: 'a/zzz' })).rejects.toThrow(/Unknown entity: a\/zzz/);
    });

    it('emits the full fresh detail on change, and stops after unsubscribe', async () => {
        const { topic, fire, set } = setup();
        const emitted: EntityDetail[] = [];
        const off = topic.subscribe({ id: 'a/ha:x' }, d => emitted.push(d));
        await Promise.resolve();
        set(detail('2'));
        fire();
        await new Promise(r => setTimeout(r));
        expect(emitted).toEqual([detail('2')]);
        off();
        fire();
        expect(emitted).toHaveLength(1);
    });
});
