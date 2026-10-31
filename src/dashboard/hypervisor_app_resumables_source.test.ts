import { EventEmitter } from 'events';

jest.mock('../hypervisor/current', () => ({ current: { application: {} } }));
jest.mock('../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import type { ResumableInfo } from '../runtime/resumable/resumable_store';
import { ScriptRegistry } from '../runtime/script/registry';
import { ScriptStateStore } from '../runtime/script/store';
import { hypervisorAppResumablesSource, appResumableCounts, type AppResumablesHost } from './hypervisor_app_resumables_source';

const info = (id: number, over: Partial<ResumableInfo> = {}): ResumableInfo =>
    ({ id, status: 'running', type: 'resumable', owner: 'APPLICATION', method: 'm', params: [1], startedAt: 5, restarts: 0, ...over });

function fakeStore(rows: ResumableInfo[] = []) {
    const store: any = Object.assign(new EventEmitter(), { rows, cancel: jest.fn(), discard: jest.fn() });
    store.list = () => store.rows;
    return store;
}

function setup(opts: { configured?: string[]; apps?: Record<string, { state?: string; rows?: ResumableInfo[]; noStore?: boolean }> } = {}) {
    const lifecycle = new EventEmitter();
    const apps: Record<string, any> = {};
    for (const [id, a] of Object.entries(opts.apps ?? {})) {
        apps[id] = { id, state: a.state ?? 'started', resumableStore: a.noStore ? undefined : fakeStore(a.rows), scripts: new ScriptRegistry() };
    }
    const host = {
        currentConfig: { apps: Object.fromEntries((opts.configured ?? Object.keys(apps)).map(id => [id, {}])) },
        listApplications: () => Object.values(apps),
        getApplication: (id: string) => apps[id],
        on: (e: string, cb: any) => lifecycle.on(e, cb),
        off: (e: string, cb: any) => lifecycle.off(e, cb),
    } as unknown as AppResumablesHost;
    return { host, source: hypervisorAppResumablesSource(host), lifecycle, apps };
}

describe('hypervisorAppResumablesSource.get', () => {
    it('maps resumables to rows keyed by id, showing the app as owner of its own methods', () => {
        const { source } = setup({ apps: { a: { rows: [
            info(7, { wait: { kind: 'sleep', until: 9 } }),
            info(8, { owner: 'other', status: 'failed', failure: { error: 'boom', attempts: 3 }, type: 'script', restarts: 2 }),
        ] } } });
        expect(source.get('a')!.resumables).toEqual([
            { key: '7', status: 'running', type: 'resumable', owner: 'a', method: 'm', params: [1], wait: { kind: 'sleep', until: 9 }, startedAt: 5, restarts: 0 },
            { key: '8', status: 'failed', type: 'script', owner: 'other', method: 'm', params: [1], startedAt: 5, restarts: 2, failure: { error: 'boom', attempts: 3 } },
        ]);
    });

    it('maps scripts to rows with their runs', () => {
        const { source, apps } = setup({ apps: { a: {} } });
        apps.a.scripts.define('scene', { mode: 'queued', limit: 4 });
        const store = new ScriptStateStore({ mode: 'queued', limit: 4 });
        apps.a.scripts.attach('scene', store);
        store.trackPending({ cancel() { }, start() { } } as any, ['evening']);
        store.refill();
        const [row] = source.get('a')!.scripts;
        expect(row).toMatchObject({ key: 'scene', mode: 'queued', limit: 4, running: 1, queued: 0 });
        expect(row.runs).toEqual([{ id: expect.any(String), params: ['evening'], startedAt: expect.any(Number), queued: false }]);
    });

    it('has nothing for a configured app without a live instance (or one that never got to start)', () => {
        const { source } = setup({ configured: ['a', 'b'], apps: { b: { noStore: true } } });
        expect(source.get('a')).toEqual({ resumables: [], scripts: [] });
        expect(source.get('b')).toEqual({ resumables: [], scripts: [] });
    });

    it('is undefined for an unknown app', () => {
        expect(setup().source.get('zzz')).toBeUndefined();
    });
});

describe('hypervisorAppResumablesSource.onChange', () => {
    it('fires when the store or the scripts change, and follows restarts onto the new instance', () => {
        const { source, apps, lifecycle } = setup({ apps: { a: {} } });
        const cb = jest.fn();
        const off = source.onChange('a', cb);
        apps.a.resumableStore.emit('change');
        expect(cb).toHaveBeenCalledTimes(1);
        apps.a.scripts.define('s', { mode: 'single' });
        expect(cb).toHaveBeenCalledTimes(2);

        // restart: a new instance
        const next = { ...apps.a, resumableStore: Object.assign(new EventEmitter(), { list: () => [] }), scripts: new ScriptRegistry() };
        const old = apps.a;
        apps.a = next;
        lifecycle.emit('app_lifecycle', next, 'started');
        expect(cb).toHaveBeenCalledTimes(3);
        old.resumableStore.emit('change');
        next.resumableStore.emit('change');
        expect(cb).toHaveBeenCalledTimes(4);

        off();
        next.resumableStore.emit('change');
        expect(cb).toHaveBeenCalledTimes(4);
        expect(lifecycle.listenerCount('app_lifecycle')).toBe(0);
    });

    it('ignores other apps lifecycle', () => {
        const { source, lifecycle } = setup({ apps: { a: {} } });
        const cb = jest.fn();
        source.onChange('a', cb);
        lifecycle.emit('app_lifecycle', { id: 'other' }, 'started');
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('hypervisorAppResumablesSource actions', () => {
    it('cancels / discards through the live store by key', () => {
        const { source, apps } = setup({ apps: { a: { rows: [info(7)] } } });
        source.cancel('a', '7');
        expect(apps.a.resumableStore.cancel).toHaveBeenCalledWith(7, 'Cancelled from the dashboard');
        source.discard('a', '7');
        expect(apps.a.resumableStore.discard).toHaveBeenCalledWith(7);
    });

    it('cancels a script run through the script registry', () => {
        const { source, apps } = setup({ apps: { a: {} } });
        const spy = jest.spyOn(apps.a.scripts, 'cancelRun').mockImplementation(() => { });
        source.cancelRun('a', 'scene', '12');
        expect(spy).toHaveBeenCalledWith('scene', 12, 'Cancelled from the dashboard');
    });

    it('refuses when the app has no running instance', () => {
        const { source } = setup({ configured: ['a', 'b'], apps: { b: { noStore: true } } });
        expect(() => source.cancel('a', '7')).toThrow(/not running/i);
        expect(() => source.discard('b', '7')).toThrow(/not running/i);
        expect(() => source.cancel('zzz', '7')).toThrow(/Unknown app/);
    });
});

describe('appResumableCounts', () => {
    it('counts listed resumables and running (not queued) script runs', () => {
        const { apps } = setup({ apps: { a: { rows: [info(1), info(2)] } } });
        apps.a.scripts.define('s', { mode: 'parallel' });
        const store = new ScriptStateStore({ mode: 'parallel' });
        apps.a.scripts.attach('s', store);
        store.trackPending({ cancel() { }, start() { } } as any);
        store.refill();
        store.trackPending({ cancel() { }, start() { } } as any);
        expect(appResumableCounts(apps.a)).toEqual({ resumables: 2, scripts: 1 });
    });

    it('has no resumable count before the app has a store', () => {
        const { apps } = setup({ apps: { a: { noStore: true } } });
        expect(appResumableCounts(apps.a)).toEqual({ scripts: 0 });
    });
});
