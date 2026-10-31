import { EventEmitter } from 'events';
import type { EntitiesSource } from './entities_topic';
import { hypervisorEntitySource, type EntityHost } from './hypervisor_entity_source';
import type { GlobalEntityRow } from './protocol';

const row = (over: Partial<GlobalEntityRow> = {}): GlobalEntityRow =>
    ({ key: 'a/ha:x', entityKey: 'ha:x', app: 'a', plugin: 'ha', domain: 'sensor', linked: true, autoClean: false, persistState: false, ...over });

const flush = () => new Promise(r => setTimeout(r));

function setup(rows: GlobalEntityRow[]) {
    const lifecycle = new EventEmitter();
    let rowsCb: (() => void) | undefined;
    const states: Record<string, any> = { 'sensor.x': { attributes: { unit: 'W' }, lastChanged: 't1', lastUpdated: 't2' } };
    const observers: { entityId: string; cb: () => void; disposed: boolean }[] = [];
    const provider = {
        entityState: (id: string) => states[id],
        observeEntityState: (entityId: string, cb: () => void) => { const o = { entityId, cb, disposed: false }; observers.push(o); return () => { o.disposed = true } },
    };
    const host = {
        listPlugins: () => [{ id: 'other', instance: {} }, { id: 'ha', instance: { appEntities: () => [], ...provider } }],
        on: (e: string, cb: any) => lifecycle.on(e, cb),
        off: (e: string, cb: any) => lifecycle.off(e, cb),
    } as unknown as EntityHost;
    const entities: EntitiesSource = {
        list: async () => rows,
        onChange: cb => { rowsCb = cb; return () => { rowsCb = undefined } },
    };
    return { source: hypervisorEntitySource(host, entities), rows, lifecycle, observers, fireRows: () => rowsCb?.(), isRowsWatched: () => !!rowsCb };
}

describe('hypervisorEntitySource', () => {
    it('merges the row with HA state and attributes', async () => {
        const t = setup([row({ entityId: 'sensor.x', state: '5' })]);
        expect(await t.source.get('a/ha:x')).toEqual({ ...row({ entityId: 'sensor.x', state: '5' }), attributes: { unit: 'W' }, lastChanged: 't1', lastUpdated: 't2' });
    });

    it('is just the row while HA does not know the entity yet; undefined if unknown', async () => {
        const t = setup([row()]);
        expect(await t.source.get('a/ha:x')).toEqual(row());
        expect(await t.source.get('a/nope')).toBeUndefined();
    });

    it('watches the state of the entity and forwards changes', async () => {
        const t = setup([row({ entityId: 'sensor.x' })]);
        const cb = jest.fn();
        t.source.onChange('a/ha:x', cb);
        await flush();
        expect(t.observers.map(o => o.entityId)).toEqual(['sensor.x']);
        t.observers[0].cb();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('binds late when the entity_id becomes known, and re-binds when it changes', async () => {
        const t = setup([row()]);
        t.source.onChange('a/ha:x', jest.fn());
        await flush();
        expect(t.observers).toEqual([]);
        t.rows[0] = row({ entityId: 'sensor.x' });
        t.fireRows();
        await flush();
        expect(t.observers.map(o => o.entityId)).toEqual(['sensor.x']);
        t.fireRows(); // unchanged id: stays bound
        await flush();
        expect(t.observers).toHaveLength(1);
        t.rows[0] = row({ entityId: 'sensor.y' });
        t.fireRows();
        await flush();
        expect(t.observers.map(o => [o.entityId, o.disposed])).toEqual([['sensor.x', true], ['sensor.y', false]]);
    });

    it('re-binds to the restarted plugin and notifies', async () => {
        const t = setup([row({ entityId: 'sensor.x' })]);
        const cb = jest.fn();
        t.source.onChange('a/ha:x', cb);
        await flush();
        t.lifecycle.emit('plugin_lifecycle');
        await flush();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(t.observers.map(o => o.disposed)).toEqual([true, false]);
    });

    it('releases everything on unsubscribe', async () => {
        const t = setup([row({ entityId: 'sensor.x' })]);
        const off = t.source.onChange('a/ha:x', jest.fn());
        await flush();
        off();
        expect(t.observers[0].disposed).toBe(true);
        expect(t.isRowsWatched()).toBe(false);
        expect(t.lifecycle.listenerCount('plugin_lifecycle')).toBe(0);
    });
});
