import type { StorageRow } from './protocol';
import { appStorageTopic, type AppStorageSource } from './app_storage_topic';

const row = (key: string, over: Partial<StorageRow> = {}): StorageRow =>
    ({ key, value: 1, size: 1, writtenAt: 1, internal: false, ...over });

function setup(initial: StorageRow[] | null = [row('a')]) {
    let cb: () => void;
    let current = initial ?? undefined;
    const source: AppStorageSource = {
        get: () => current && { path: '.typedaemon/app_environments/x/.persistence.jkv', rows: current },
        onChange: (_id, f) => { cb = f; return () => { cb = undefined } },
    };
    return { topic: appStorageTopic(source), fire: () => cb?.(), set: (r?: StorageRow[]) => { current = r }, subscribed: () => !!cb };
}

describe('appStorage topic', () => {
    it('snapshots the store path and rows of the requested app', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ path: '.typedaemon/app_environments/x/.persistence.jkv', rows: [row('a')] });
    });

    it('rejects unknown apps', async () => {
        await expect(setup(null).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits only written rows as upserts and deleted keys as removals', async () => {
        const { topic, fire, set } = setup([row('a'), row('b'), row('c')]);
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        await topic.snapshot({ id: 'x' });
        set([row('a'), row('b', { value: 2, writtenAt: 2 }), row('d')]);
        fire();
        await new Promise(r => setImmediate(r));
        expect(emitted).toEqual([{ upsert: [row('b', { value: 2, writtenAt: 2 }), row('d')], remove: ['c'] }]);
    });

    it('stays quiet when nothing changed, and stops after unsubscribe', async () => {
        const { topic, fire, subscribed } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe({ id: 'x' }, d => emitted.push(d));
        fire();
        await new Promise(r => setImmediate(r));
        expect(emitted).toEqual([]);
        off();
        expect(subscribed()).toBe(false);
    });
});
