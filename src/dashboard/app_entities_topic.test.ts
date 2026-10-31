import type { EntityRow } from './protocol';
import { appEntitiesTopic, type AppEntitiesSource } from './app_entities_topic';

const row = (key: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key, plugin: 'ha', domain: 'sensor', linked: true, autoClean: false, persistState: false, ...over });

function setup(initial: EntityRow[] | undefined | null = [row('a')]) {
    let cb: () => void;
    let current = initial ?? undefined;
    const source: AppEntitiesSource = {
        list: () => current,
        onChange: (_id, f) => { cb = f; return () => { cb = undefined } },
    };
    return { topic: appEntitiesTopic(source), fire: () => cb?.(), set: (r?: EntityRow[]) => { current = r } };
}

describe('appEntities topic', () => {
    it('snapshots the rows of the requested app', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ rows: [row('a')] });
    });

    it('rejects unknown apps', async () => {
        await expect(setup(null).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits only changed/new rows as upserts and vanished ones as removals', async () => {
        const { topic, fire, set } = setup([row('a'), row('b'), row('c')]);
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        await topic.snapshot({ id: 'x' });
        set([row('a'), row('b', { state: 'on' }), row('d')]);
        fire();
        expect(emitted).toEqual([{ upsert: [row('b', { state: 'on' }), row('d')], remove: ['c'] }]);
    });

    it('stays quiet when nothing actually changed', async () => {
        const { topic, fire } = setup();
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        await topic.snapshot({ id: 'x' });
        fire();
        expect(emitted).toEqual([]);
    });

    it('treats an app that went away (restart gap) as having no rows, then recreates them', async () => {
        const { topic, fire, set } = setup();
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        await topic.snapshot({ id: 'x' });
        set([]); fire();
        set([row('a')]); fire();
        expect(emitted).toEqual([{ remove: ['a'] }, { upsert: [row('a')] }]);
    });

    it('stops listening on unsubscribe', () => {
        const { topic, fire } = setup();
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d))();
        fire();
        expect(emitted).toEqual([]);
    });
});
