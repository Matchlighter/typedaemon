import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { hypervisorAppsSource, type AppsHost } from './hypervisor_apps_source';
import type { AppsChange } from './apps_topic';

function fakeInstance(id: string, over: any = {}) {
    return {
        id, state: 'started', stateSince: 100, lastError: undefined, isThickApp: false,
        options: { source: `apps/${id}.ts`, human_name: undefined },
        resumableStore: { list: () => [{}, {}] },
        schedules: { list: () => [{}, {}, {}] },
        ...over,
    };
}

function setup(config: Record<string, any>, instances: any[], plugins: any[] = []) {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-apps-'));
    const events = new EventEmitter();
    let cfgWatch: () => void;
    const stopped = new Set<string>();
    const host = {
        working_directory: wd,
        operations_directory: path.join(wd, '.typedaemon'),
        defaultAppOperatingDirectory: (id: string) => path.join(wd, '.typedaemon', 'app_environments', id),
        defaultAppPersistenceFile: (id: string) => path.join(wd, '.typedaemon', 'app_environments', id, 'persistence.json'),
        currentConfig: { apps: config },
        listApplications: () => instances,
        listPlugins: () => plugins,
        isApplicationStopped: (id: string) => stopped.has(id),
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
        watchConfigEntry: (_k: string, cb: () => void) => { cfgWatch = cb; return () => { cfgWatch = undefined } },
    } as unknown as AppsHost;
    const changes: AppsChange[] = [];
    const source = hypervisorAppsSource(host);
    const off = source.onChange(c => changes.push(c));
    return { stopped, wd, source, changes, events, off, host, config, instances, fireConfig: () => cfgWatch?.() };
}

const entityRow = (key: string, linked = true) => ({ key, plugin: 'ha', domain: 'sensor', linked, autoClean: true, persistState: false });
function entityProvider(rows: any[]) {
    const entityEvents = new EventEmitter();
    return { entityEvents, appEntities: () => rows, observeAppEntities: () => () => { }, deleteUnlinkedEntity: async () => { } };
}

describe('hypervisorAppsSource', () => {
    it('counts the (linked) entities of live apps from the entity providers', () => {
        const provider = entityProvider([entityRow('1'), entityRow('2'), entityRow('3', false)]);
        const { source } = setup({ a: {} }, [fakeInstance('a')], [{ id: 'ha', instance: provider }]);
        expect(source.list()[0].entities).toBe(2);
    });

    it('leaves the entity count out when no plugin provides entities', () => {
        const { source } = setup({ a: {} }, [fakeInstance('a')]);
        expect(source.list()[0]).not.toHaveProperty('entities');
    });

    it('re-emits the row when the app\'s entities change', () => {
        const rows = [entityRow('1')];
        const provider = entityProvider(rows);
        const inst = fakeInstance('a');
        const { changes, off } = setup({ a: {} }, [inst], [{ id: 'ha', instance: provider }]);
        rows.push(entityRow('2'));
        provider.entityEvents.emit('change', inst);
        expect(changes).toEqual([{ type: 'app', row: expect.objectContaining({ id: 'a', entities: 2 }) }]);
        off();
        provider.entityEvents.emit('change', inst);
        expect(changes).toHaveLength(1);
    });

    it('re-resolves entity providers when a plugin restarts', () => {
        const inst = fakeInstance('a');
        const stale = entityProvider([entityRow('1')]);
        const fresh = entityProvider([entityRow('1')]);
        const plugins = [{ id: 'ha', instance: stale }];
        const { changes, events } = setup({ a: {} }, [inst], plugins);
        plugins[0] = { id: 'ha', instance: fresh };
        events.emit('plugin_lifecycle', plugins[0], 'started');
        stale.entityEvents.emit('change', inst);
        expect(changes).toHaveLength(0);
        fresh.entityEvents.emit('change', inst);
        expect(changes).toHaveLength(1);
    });

    it('lists instance rows with name, source, kind, uptime anchor and resumable count', () => {
        const { source } = setup({ a: {} }, [fakeInstance('a', { isThickApp: true, options: { source: 'apps/a/index.ts', human_name: 'Alpha' } })]);
        expect(source.list()).toEqual([{ id: 'a', name: 'Alpha', source: 'apps/a/index.ts', kind: 'thick', state: 'started', since: 100, resumables: 2, schedules: 3 }]);
    });

    it('counts resumables that failed to resume, only when there are some', () => {
        const store = { list: () => [{}, { failure: { message: 'x', attempts: 1 } }, { failure: { message: 'y', attempts: 2 } }] };
        const { source } = setup({ a: {}, b: {} }, [fakeInstance('a', { resumableStore: store }), fakeInstance('b')]);
        const rows = source.list();
        expect(rows[0].failedResumes).toBe(2);
        expect(rows[1]).not.toHaveProperty('failedResumes');
    });

    it('lists configured apps that have no instance as stopped', () => {
        const { source } = setup({ b: { source: 'apps/b.ts' } }, []);
        const [r] = source.list();
        expect(r).toMatchObject({ id: 'b', name: 'b', source: 'apps/b.ts', state: 'stopped' });
    });

    it('surfaces the last error with its phase', () => {
        const { source } = setup({ a: {} }, [fakeInstance('a', { state: 'dead', lastError: { message: 'boom', phase: 'compiling' } })]);
        expect(source.list()[0]).toMatchObject({ state: 'dead', error: { message: 'boom', phase: 'compiling' } });
    });

    it('emits a row per lifecycle event, from the event instance (it may already be unlisted)', () => {
        const { changes, events } = setup({ a: {} }, []);
        events.emit('app_lifecycle', fakeInstance('a', { state: 'stopping' }), 'stopping');
        expect(changes).toEqual([{ type: 'app', row: expect.objectContaining({ id: 'a', state: 'stopping' }) }]);
    });

    it('flags rows of apps stopped by a runtime override, with or without an instance', () => {
        const { source, stopped } = setup({ a: {}, b: { source: 'b.ts' } }, [fakeInstance('a', { state: 'stopped' })]);
        stopped.add('a'); stopped.add('b');
        expect(source.list().map(r => [r.id, r.stoppedOverride])).toEqual([['a', true], ['b', true]]);
    });

    it('emits the row when an override is set or cleared', () => {
        const { changes, events, stopped } = setup({ b: { source: 'b.ts' } }, []);
        stopped.add('b');
        events.emit('app_override_changed', 'b');
        expect(changes).toEqual([{ type: 'app', row: expect.objectContaining({ id: 'b', state: 'stopped', stoppedOverride: true }) }]);
    });

    it('removes the row (and refreshes orphans) when an app no longer in config stops', () => {
        const { changes, events } = setup({}, []);
        events.emit('app_lifecycle', fakeInstance('gone', { state: 'stopped' }), 'stopped');
        expect(changes).toEqual([{ type: 'removed', id: 'gone' }, { type: 'orphans' }]);
    });

    it('config change adds new apps and removes dropped ones without a live instance', () => {
        const t = setup({ a: {} }, [fakeInstance('a')]);
        t.config['b'] = { source: 'apps/b.ts' };
        delete t.config['a']; t.instances.length = 0;
        t.fireConfig();
        expect(t.changes).toEqual(expect.arrayContaining([
            { type: 'app', row: expect.objectContaining({ id: 'b', state: 'stopped' }) },
            { type: 'removed', id: 'a' },
            { type: 'orphans' },
        ]));
    });

    it('orphans = app_environments dirs not in config', async () => {
        const t = setup({ a: {} }, []);
        const envs = path.join(t.host.operations_directory, 'app_environments');
        fs.mkdirSync(path.join(envs, 'a'), { recursive: true });
        fs.mkdirSync(path.join(envs, 'old_presence'), { recursive: true });
        fs.writeFileSync(path.join(envs, 'stray.txt'), '');
        fs.writeFileSync(path.join(envs, 'old_presence', 'x.bin'), 'x'.repeat(10));
        const [o, ...rest] = await t.source.orphans();
        expect(rest).toEqual([]);
        expect(o).toEqual({ id: 'old_presence', summary: { removedAt: expect.any(Number), entities: 0, storageKeys: 0, dirBytes: 10, destroyers: [] } });
    });

    it('refreshes the orphan list when an orphan was cleaned up', () => {
        const { changes, events } = setup({}, []);
        events.emit('orphans_changed');
        expect(changes).toEqual([{ type: 'orphans' }]);
    });

    it('no orphans when the environments dir does not exist', async () => {
        expect(await setup({}, []).source.orphans()).toEqual([]);
    });

    it('stops listening on dispose', () => {
        const t = setup({}, []);
        t.off();
        t.events.emit('app_lifecycle', fakeInstance('a'), 'started');
        expect(t.changes).toEqual([]);
    });
});
