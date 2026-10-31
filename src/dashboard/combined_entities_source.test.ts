import { combinedEntitiesSource, type CombinedEntitiesParts } from './combined_entities_source';
import type { EntityRow } from './protocol';

const row = (key: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key: `ha:${key}`, plugin: 'ha', domain: 'sensor', linked: true, autoClean: false, persistState: false, ...over });

function setup() {
    const appRows: Record<string, EntityRow[]> = { a: [row('x')], b: [row('y', { linked: false })] };
    const orphanRows: Record<string, EntityRow[]> = { gone: [row('z', { linked: false })] };
    let appIds = ['a', 'b'];
    let orphanIds = ['gone'];
    const appListeners = new Map<string, Set<() => void>>();
    let appsCb: (() => void) | undefined, orphansCb: (() => void) | undefined;
    const parts: CombinedEntitiesParts = {
        appIds: () => appIds,
        onAppsChanged: cb => { appsCb = cb; return () => { appsCb = undefined } },
        apps: {
            list: id => appRows[id],
            onChange: (id, cb) => { (appListeners.get(id) ?? appListeners.set(id, new Set()).get(id)).add(cb); return () => appListeners.get(id).delete(cb) },
        },
        orphans: {
            ids: async () => orphanIds,
            entities: async id => orphanRows[id],
            onChange: cb => { orphansCb = cb; return () => { orphansCb = undefined } },
        },
    };
    return {
        source: combinedEntitiesSource(parts), appRows, orphanRows,
        fireApp: (id: string) => appListeners.get(id)?.forEach(f => f()),
        listeners: (id: string) => appListeners.get(id)?.size ?? 0,
        addApp: (id: string, rows: EntityRow[]) => { appIds = [...appIds, id]; appRows[id] = rows; appsCb?.() },
        removeApp: (id: string) => { appIds = appIds.filter(i => i !== id); appsCb?.() },
        setOrphans: (ids: string[]) => { orphanIds = ids; orphansCb?.() },
    };
}

describe('combinedEntitiesSource', () => {
    it('lists every app and orphan row, keyed by app, remembering the app-local key', async () => {
        const rows = await setup().source.list();
        expect(rows).toEqual([
            { ...row('x'), key: 'a/ha:x', entityKey: 'ha:x', app: 'a' },
            { ...row('y', { linked: false }), key: 'b/ha:y', entityKey: 'ha:y', app: 'b' },
            { ...row('z', { linked: false }), key: 'gone/ha:z', entityKey: 'ha:z', app: 'gone', orphan: true },
        ]);
    });

    it('skips apps the source does not know (just left the config)', async () => {
        const t = setup();
        delete t.appRows.b;
        expect((await t.source.list()).map(r => r.app)).toEqual(['a', 'gone']);
    });

    it('notifies when any app changes, and follows apps that join or leave', () => {
        const t = setup();
        const cb = jest.fn();
        t.source.onChange(cb);
        t.fireApp('b');
        expect(cb).toHaveBeenCalledTimes(1);
        t.addApp('c', [row('w')]);
        expect(cb).toHaveBeenCalledTimes(2);
        t.fireApp('c');
        expect(cb).toHaveBeenCalledTimes(3);
        t.removeApp('a');
        expect(t.listeners('a')).toBe(0);
        t.fireApp('a');
        expect(cb).toHaveBeenCalledTimes(4);
    });

    it('re-reads orphan leftovers only when orphans change, not on app changes', async () => {
        const t = setup();
        t.source.onChange(() => { });
        await t.source.list();
        t.orphanRows.gone = [row('q', { linked: false })];
        t.fireApp('a');
        expect((await t.source.list()).filter(r => r.orphan).map(r => r.entityKey)).toEqual(['ha:z']);
        t.setOrphans(['gone']);
        expect((await t.source.list()).filter(r => r.orphan).map(r => r.entityKey)).toEqual(['ha:q']);
    });

    it('notifies on orphan changes, and stops everything on dispose', () => {
        const t = setup();
        const cb = jest.fn();
        const off = t.source.onChange(cb);
        t.setOrphans([]);
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        t.fireApp('a'); t.addApp('d', []); t.setOrphans(['gone']);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(t.listeners('a')).toBe(0);
    });
});
