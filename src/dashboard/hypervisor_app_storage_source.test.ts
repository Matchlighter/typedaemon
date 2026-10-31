import { appDirectory, persistenceFile } from '../hypervisor/app_paths';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../hypervisor/logging', () => ({ logMessage: jest.fn() }));

import { PersistentStorage } from '../hypervisor/persistent_storage';
import { appStorageCounts, hypervisorAppStorageSource, LAZY_BYTES, type AppStorageHost } from './hypervisor_app_storage_source';

const NOW = { min_time_to_disk: 0, max_time_to_disk: 0 };

let dir: string;
let wd: string;
let open: PersistentStorage[];
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-dash-storage-'));
    wd = dir;
    open = [];
});
afterEach(async () => {
    for (const s of open) await s.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
});

const opsDir = () => path.join(wd, '.typedaemon');
const fileOf = (id: string) => path.join(opsDir(), 'app_environments', id, '.persistence.jkv');

/** Writes a store file the way a previous run would have */
async function seed(id: string, values: Record<string, any>) {
    fs.mkdirSync(path.dirname(fileOf(id)), { recursive: true });
    const s = new PersistentStorage(fileOf(id));
    for (const [k, v] of Object.entries(values)) s.setValue(k, v, NOW);
    await s.dispose();
}

function setup(opts: { configured?: string[]; live?: Record<string, { state: string; storage?: PersistentStorage }>; liveForExclusive?: (live: any) => any } = {}) {
    const lifecycle = new EventEmitter();
    const live = Object.fromEntries(Object.entries(opts.live ?? {}).map(([id, l]) => [id, { id, state: l.state, persistedStorage: l.storage, operating_directory: path.dirname(fileOf(id)), persistence_file: fileOf(id) }]));
    const exclusive: string[] = [];
    const host = {
        working_directory: wd,
        withApplicationExclusive: async (id: string, fn: any) => { exclusive.push(id); return fn(opts.liveForExclusive ? opts.liveForExclusive(live) : live[id]) },
        operations_directory: opsDir(),
        defaultAppOperatingDirectory: (id: string) => appDirectory(opsDir(), id),
        defaultAppPersistenceFile: (id: string) => persistenceFile(appDirectory(opsDir(), id)),
        currentConfig: { apps: Object.fromEntries((opts.configured ?? Object.keys(live)).map(id => [id, {}])) },
        listApplications: () => Object.values(live),
        getApplication: (id: string) => live[id],
        on: (e: string, cb: any) => lifecycle.on(e, cb),
        off: (e: string, cb: any) => lifecycle.off(e, cb),
    } as unknown as AppStorageHost;
    return { host, source: hypervisorAppStorageSource(host), lifecycle, live, exclusive };
}

function liveStorage(id: string) {
    fs.mkdirSync(path.dirname(fileOf(id)), { recursive: true });
    const s = new PersistentStorage(fileOf(id));
    open.push(s);
    return s;
}

describe('hypervisorAppStorageSource.get', () => {
    it('lists the live store: path relative to the working dir, values, sizes, write times, internal flag', async () => {
        const storage = liveStorage('a');
        storage.setValue('@persistent-count', 3, NOW);
        storage.setValue('_destroyers', [{ uuid: 'x' }], NOW);
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        const snap = (await source.get('a'))!;
        expect(snap.path).toBe(path.join('.typedaemon', 'app_environments', 'a', '.persistence.jkv'));
        const byKey = Object.fromEntries(snap.rows.map(r => [r.key, r]));
        expect(byKey['@persistent-count']).toMatchObject({ value: 3, size: 1, internal: false, writtenAt: storage.keyInfo('@persistent-count').at });
        expect(byKey['_destroyers']).toMatchObject({ value: [{ uuid: 'x' }], internal: true });
    });

    it('sends only the shape of values over the lazy threshold', async () => {
        const storage = liveStorage('a');
        const big = Array.from({ length: LAZY_BYTES }, (_, i) => i % 10);
        storage.setValue('big', big, NOW);
        storage.setValue('small', { a: 1 }, NOW);
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        const rows = Object.fromEntries((await source.get('a'))!.rows.map(r => [r.key, r]));
        expect(rows.big.value).toBeUndefined();
        expect(rows.big.lazy).toEqual({ kind: 'array', count: big.length, size: JSON.stringify(big).length });
        expect(rows.big.size).toBe(JSON.stringify(big).length);
        expect(rows.small.lazy).toBeUndefined();
    });

    it('reads the store file of an app with no running instance, using the file time for write times', async () => {
        await seed('a', { k: 'v' });
        const { source } = setup({ configured: ['a'] });
        const snap = (await source.get('a'))!;
        expect(snap.rows).toEqual([{ key: 'k', value: 'v', size: 3, writtenAt: fs.statSync(fileOf('a')).mtimeMs, internal: false }]);
    });

    it('reads the file of a dead/stopped instance rather than its disposed store', async () => {
        await seed('a', { k: 1 });
        const stale = new PersistentStorage(path.join(dir, 'closed.jkv'));
        open.push(stale);
        stale.setValue('gone', 1, NOW);
        const { source } = setup({ live: { a: { state: 'dead', storage: stale } } });
        expect((await source.get('a'))!.rows.map(r => r.key)).toEqual(['k']);
    });

    it('is empty when nothing was ever stored, and undefined for unknown apps', async () => {
        const { source } = setup({ configured: ['a'] });
        expect((await source.get('a'))!.rows).toEqual([]);
        expect(await source.get('zzz')).toBeUndefined();
    });
});

describe('hypervisorAppStorageSource.onChange', () => {
    it('notifies on writes and deletes of the live store, and stops after dispose', async () => {
        const storage = liveStorage('a');
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        const cb = jest.fn();
        const off = source.onChange('a', cb);
        storage.setValue('k', 1, NOW);
        expect(cb).toHaveBeenCalledTimes(1);
        await storage.deleteKey('k');
        expect(cb).toHaveBeenCalledTimes(2);
        off();
        storage.setValue('k', 2, NOW);
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('follows a restart onto the new instance store and notifies', () => {
        const old = liveStorage('a');
        const { source, lifecycle, live } = setup({ live: { a: { state: 'started', storage: old } } });
        const cb = jest.fn();
        source.onChange('a', cb);
        const fresh = liveStorage('a');
        const next = { id: 'a', state: 'compiling', persistedStorage: fresh };
        live.a = next as any;
        lifecycle.emit('app_lifecycle', next, 'compiling');
        expect(cb).toHaveBeenCalledTimes(1);
        old.setValue('k', 1, NOW);
        expect(cb).toHaveBeenCalledTimes(1);
        fresh.setValue('k', 1, NOW);
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('ignores lifecycle events of other apps', () => {
        const { source, lifecycle } = setup({ live: { a: { state: 'started', storage: liveStorage('a') } } });
        const cb = jest.fn();
        source.onChange('a', cb);
        lifecycle.emit('app_lifecycle', { id: 'b', state: 'started' }, 'started');
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('hypervisorAppStorageSource.value / remove', () => {
    it('returns the full value of a key', async () => {
        const storage = liveStorage('a');
        storage.setValue('k', { deep: [1, 2] }, NOW);
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        expect(await source.value('a', 'k')).toEqual({ deep: [1, 2] });
        await expect(source.value('a', 'nope')).rejects.toThrow(/No key 'nope'/);
    });

    it('removes a key from the live store only (the app keeps what it holds in memory)', async () => {
        const storage = liveStorage('a');
        storage.setValue('k', 1, NOW);
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        await source.remove('a', 'k');
        expect(storage.hasKey('k')).toBe(false);
        const reread = new PersistentStorage(fileOf('a'));
        await reread.load();
        expect(reread.hasKey('k')).toBe(false);
    });

    it('refuses to remove internal (TypeDaemon-owned) keys', async () => {
        const storage = liveStorage('a');
        storage.setValue('_destroyers', [], NOW);
        const { source } = setup({ live: { a: { state: 'started', storage } } });
        await expect(source.remove('a', '_destroyers')).rejects.toThrow(/internal key '_destroyers'/);
        expect(storage.hasKey('_destroyers')).toBe(true);
    });

    it('removes a key from the file of an app that is not running', async () => {
        await seed('a', { k: 1, other: 2 });
        const { source } = setup({ configured: ['a'] });
        await source.remove('a', 'k');
        const reread = new PersistentStorage(fileOf('a'));
        await reread.load();
        expect(reread.keys).toEqual(['other']);
    });

    it('deletes under exclusive access to the app, so an app start cannot open the file meanwhile', async () => {
        await seed('a', { k: 1 });
        const { source, exclusive } = setup({ configured: ['a'] });
        await source.remove('a', 'k');
        expect(exclusive).toEqual(['a']);
    });

    it('routes to the live store if the app came up before the exclusive access was granted', async () => {
        await seed('a', { k: 1 });
        const storage = liveStorage('a');
        storage.setValue('k', 1, NOW);
        const { source } = setup({ configured: ['a'], liveForExclusive: () => ({ id: 'a', state: 'started', persistedStorage: storage }) });
        await source.remove('a', 'k');
        expect(storage.hasKey('k')).toBe(false);
    });

    it('does not hold up reads for exclusive access (an app start can take long)', async () => {
        await seed('a', { k: 1 });
        const { source, exclusive } = setup({ configured: ['a'] });
        await source.get('a');
        expect(exclusive).toEqual([]);
    });

    it('rejects unknown apps', async () => {
        const { source } = setup();
        await expect(source.remove('zzz', 'k')).rejects.toThrow(/Unknown app: zzz/);
        await expect(source.value('zzz', 'k')).rejects.toThrow(/Unknown app: zzz/);
    });
});

describe('storage of an orphan (not configured, dir still on disk)', () => {
    it('can be read: rows and lazy values', async () => {
        await seed('old', { k: 1 });
        const { source } = setup({ configured: [] });
        expect((await source.get('old'))!.rows.map(r => r.key)).toEqual(['k']);
        expect(await source.value('old', 'k')).toBe(1);
    });

    it('is not "unknown" only because the id looks odd: ids outside app_environments stay unknown', async () => {
        const { source } = setup({ configured: [] });
        expect(await source.get('..')).toBeUndefined();
        await expect(source.value('..', 'k')).rejects.toThrow(/Unknown app/);
    });
});

describe('appStorageCounts', () => {
    it('counts the user keys of a live store (internal ones are bookkeeping)', () => {
        const storage = liveStorage('a');
        storage.setValue('u1', 1, NOW);
        storage.setValue('u2', 1, NOW);
        storage.setValue('_destroyers', 1, NOW);
        const { host } = setup({ live: { a: { state: 'started', storage } } });
        expect(appStorageCounts(host.listApplications()[0])).toEqual({ storage: 2 });
    });

    it('has no count without a live store', () => {
        const { host } = setup({ live: { a: { state: 'dead', storage: liveStorage('a') } } });
        expect(appStorageCounts(host.listApplications()[0])).toBeUndefined();
    });
});
