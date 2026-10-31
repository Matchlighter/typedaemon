import { EventEmitter } from 'events';
import { appEntityCounts, hypervisorAppEntitiesSource, type AppEntitiesHost } from './hypervisor_app_entities_source';
import type { EntityRow } from './protocol';

const row = (key: string, linked = true): EntityRow =>
    ({ key, plugin: 'ha', domain: 'sensor', linked, autoClean: true, persistState: false });

function setup(opts: { apps?: Record<string, any>; configured?: string[]; rows?: Record<string, EntityRow[]> } = {}) {
    const lifecycle = new EventEmitter();
    const rows = opts.rows ?? {};
    const apps = opts.apps ?? { a: { id: 'a' } };
    const observers: { app: any; cb: () => void; disposed: boolean }[] = [];
    const entityEvents = new EventEmitter();
    const deleted: any[] = [];
    const provider = {
        appEntities: (app: any) => rows[app.id] ?? [],
        observeAppEntities: (app: any, cb: () => void) => { const o = { app, cb, disposed: false }; observers.push(o); return () => { o.disposed = true } },
        deleteUnlinkedEntity: async (app: any, cuid: string) => { deleted.push([app.id, cuid]) },
        entityEvents,
    };
    const host = {
        currentConfig: { apps: Object.fromEntries((opts.configured ?? Object.keys(apps)).map(id => [id, {}])) },
        getApplication: (id: string) => apps[id],
        listPlugins: () => [{ id: 'other', instance: {} }, { id: 'ha', instance: provider }, { id: 'booting', instance: undefined }],
        on: (e: string, cb: any) => lifecycle.on(e, cb),
        off: (e: string, cb: any) => lifecycle.off(e, cb),
    } as unknown as AppEntitiesHost;
    return { host, source: hypervisorAppEntitiesSource(host), lifecycle, observers, rows, apps, deleted, entityEvents };
}

describe('hypervisorAppEntitiesSource', () => {
    it('lists the rows of the app from every entity provider plugin', () => {
        const { source } = setup({ rows: { a: [row('ha:x'), row('ha:y', false)] } });
        expect(source.list('a')).toEqual([row('ha:x'), row('ha:y', false)]);
    });

    it('lists nothing for a configured app without an instance (stopped / mid-restart), and undefined for unknown apps', () => {
        const { source } = setup({ apps: {}, configured: ['a'] });
        expect(source.list('a')).toEqual([]);
        expect(source.list('zzz')).toBeUndefined();
    });

    it('forwards provider changes', () => {
        const { source, observers } = setup();
        const cb = jest.fn();
        source.onChange('a', cb);
        observers[0].cb();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('re-binds to the new instance on every lifecycle event of the app, and notifies', () => {
        const { source, observers, lifecycle } = setup();
        const cb = jest.fn();
        source.onChange('a', cb);
        const next = { id: 'a' };
        lifecycle.emit('app_lifecycle', next, 'starting');
        expect(observers[0].disposed).toBe(true);
        expect(observers[1]).toMatchObject({ app: next, disposed: false });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('ignores other apps lifecycle events', () => {
        const { source, observers, lifecycle } = setup();
        const cb = jest.fn();
        source.onChange('a', cb);
        lifecycle.emit('app_lifecycle', { id: 'b' }, 'started');
        expect(observers).toHaveLength(1);
        expect(cb).not.toHaveBeenCalled();
    });

    it('stops observing and listening on dispose', () => {
        const { source, observers, lifecycle } = setup();
        const cb = jest.fn();
        source.onChange('a', cb)();
        expect(observers[0].disposed).toBe(true);
        lifecycle.emit('app_lifecycle', { id: 'a' }, 'started');
        expect(cb).not.toHaveBeenCalled();
    });

    it('deletes through the plugin owning the row, with the registry key', async () => {
        const { source, deleted } = setup();
        await source.remove('a', 'ha:x-sensor');
        expect(deleted).toEqual([['a', 'x-sensor']]);
    });

    it('rejects keys of unknown plugins and apps that are not running', async () => {
        const { source } = setup({ apps: {}, configured: ['a'] });
        await expect(source.remove('a', 'ha:x')).rejects.toThrow(/not running/);
        const s2 = setup().source;
        await expect(s2.remove('a', 'nope:x')).rejects.toThrow(/Unknown plugin/);
    });
});

describe('appEntityCounts', () => {
    it('counts linked entities and unlinked ones separately', () => {
        const { host, apps } = setup({ rows: { a: [row('1'), row('2'), row('3', false)] } });
        expect(appEntityCounts(host, apps.a)).toEqual({ entities: 2, unlinkedEntities: 1 });
    });

    it('is undefined when no plugin can tell', () => {
        const { host, apps } = setup();
        (host as any).listPlugins = () => [];
        expect(appEntityCounts(host, apps.a)).toBeUndefined();
    });
});
