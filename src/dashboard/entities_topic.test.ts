import type { GlobalEntityRow } from './protocol';
import { entitiesTopic, type EntitiesSource } from './entities_topic';

const row = (app: string, key: string, over: Partial<GlobalEntityRow> = {}): GlobalEntityRow =>
    ({ key: `${app}/ha:${key}`, entityKey: `ha:${key}`, app, plugin: 'ha', domain: 'sensor', linked: true, autoClean: false, persistState: false, ...over });

function setup(initial: GlobalEntityRow[] = [row('a', 'x')]) {
    let cb: () => void;
    let current = initial;
    const source: EntitiesSource = {
        list: async () => current,
        onChange: f => { cb = f; return () => { cb = undefined } },
    };
    return { topic: entitiesTopic(source), fire: () => cb?.(), set: (r: GlobalEntityRow[]) => { current = r } };
}
const flush = () => new Promise(r => setImmediate(r));

describe('entities topic', () => {
    it('snapshots the entities of every app', async () => {
        const rows = [row('a', 'x'), row('b', 'y')];
        expect(await setup(rows).topic.snapshot(undefined)).toEqual({ rows });
    });

    it('emits only changed/new rows as upserts and vanished ones as removals, across apps', async () => {
        const { topic, fire, set } = setup([row('a', 'x'), row('b', 'y'), row('b', 'z')]);
        const emitted: any[] = [];
        topic.subscribe(undefined, d => emitted.push(d));
        await topic.snapshot(undefined);
        set([row('a', 'x'), row('b', 'y', { state: 'on' }), row('c', 'w')]);
        fire(); await flush();
        expect(emitted).toEqual([{ upsert: [row('b', 'y', { state: 'on' }), row('c', 'w')], remove: ['b/ha:z'] }]);
    });

    it('stays quiet when nothing changed, and after dispose', async () => {
        const { topic, fire, set } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe(undefined, d => emitted.push(d));
        await topic.snapshot(undefined);
        fire(); await flush();
        expect(emitted).toEqual([]);
        off();
        set([]); fire(); await flush();
        expect(emitted).toEqual([]);
    });
});
