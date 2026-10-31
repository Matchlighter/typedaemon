import { appDirectory, persistenceFile } from '../hypervisor/app_paths';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../hypervisor/logging', () => ({ logMessage: jest.fn() }));

import { PersistentStorage } from '../hypervisor/persistent_storage';
import { registerPluginManifests } from '../plugins/manifest';
import { hypervisorOrphanSource, type OrphanSourceHost } from './hypervisor_orphan_source';

const NOW = { min_time_to_disk: 0, max_time_to_disk: 0 };

let wd: string;
beforeEach(() => { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-orphan-src-')) });
afterEach(() => fs.rmSync(wd, { recursive: true, force: true }));

const envs = () => path.join(wd, '.typedaemon', 'app_environments');

async function seed(id: string, values: Record<string, any>, extra: Record<string, string> = {}) {
    const dir = path.join(envs(), id);
    fs.mkdirSync(dir, { recursive: true });
    const s = new PersistentStorage(path.join(dir, '.persistence.jkv'));
    for (const [k, v] of Object.entries(values)) s.setValue(k, v, NOW);
    await s.dispose();
    for (const [f, c] of Object.entries(extra)) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), c);
    }
}

const haRow = (key: string, over: any = {}) => ({ key, plugin: 'ha', domain: 'sensor', linked: false, autoClean: true, persistState: false, ...over });

registerPluginManifests();

function setup(opts: { configured?: string[]; live?: string[]; providers?: any[]; destroy?: (id: string) => Promise<void> } = {}) {
    const events = new EventEmitter();
    let cfgWatch: (() => void) | undefined;
    const destroyed: string[] = [];
    const host = {
        working_directory: wd,
        operations_directory: path.join(wd, '.typedaemon'),
        defaultAppOperatingDirectory: (id: string) => appDirectory(path.join(wd, '.typedaemon'), id),
        defaultAppPersistenceFile: (id: string) => persistenceFile(appDirectory(path.join(wd, '.typedaemon'), id)),
        currentConfig: { apps: Object.fromEntries((opts.configured ?? []).map(id => [id, {}])) },
        listApplications: () => (opts.live ?? []).map(id => ({ id })),
        listPlugins: () => (opts.providers ?? []).map((instance, i) => ({ id: `ha${i}`, instance })),
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
        watchConfigEntry: (_k: string, cb: () => void) => { cfgWatch = cb; return () => { cfgWatch = undefined } },
        destroyApplication: async (id: string) => { await opts.destroy?.(id); destroyed.push(id); },
    } as unknown as OrphanSourceHost;
    return { host, source: hypervisorOrphanSource(host), events, destroyed, fireConfig: () => cfgWatch?.() };
}

const provider = (rows: any[]) => ({ appEntities: () => [], observeAppEntities: () => () => { }, deleteUnlinkedEntity: async () => { }, entityEvents: new EventEmitter(), storedEntities: jest.fn(() => rows) });

describe('hypervisorOrphanSource.get', () => {
    it('has no leftovers for an app that is configured, running, unknown or oddly named', async () => {
        await seed('cfg', {}); await seed('run', {});
        const { source } = setup({ configured: ['cfg'], live: ['run'] });
        for (const id of ['cfg', 'run', 'nope', '..']) expect(await source.get(id)).toEqual({ id });
    });

    it('measures the operating dir (size and file count, nested files included)', async () => {
        await seed('old', { k: 1 }, { 'logs/a.log': 'aaaa', 'logs/b.log': 'bb' });
        const l = (await setup().source.get('old')).leftovers!;
        const store = fs.statSync(path.join(envs(), 'old', '.persistence.jkv'));
        expect(l.dir).toEqual({ path: path.join('.typedaemon', 'app_environments', 'old'), bytes: store.size + 6, files: 3 });
    });

    it('lists every stored key, internal ones flagged', async () => {
        await seed('old', { mine: { a: 1 }, _destroyers: {}, 'entity_state:x': 1 });
        const l = (await setup().source.get('old')).leftovers!;
        expect(Object.fromEntries(l.storage.map(r => [r.key, r.internal]))).toEqual({ mine: false, _destroyers: true, 'entity_state:x': true });
        expect(l.storage.find(r => r.key === 'mine')!.value).toEqual({ a: 1 });
    });

    it('lists the pending destroyers', async () => {
        await seed('old', { _destroyers: { 'HAEntities-1': { uuid: 'HAEntities-1', type: 'HAEntities', options: { plugin_id: 'home_assistant' } } } });
        const l = (await setup().source.get('old')).leftovers!;
        expect(l.destroyers).toEqual([{ uuid: 'HAEntities-1', type: 'HAEntities', options: { plugin_id: 'home_assistant' } }]);
    });

    it('lists the entities still in HA from the entity providers, reading the orphan\'s own store', async () => {
        await seed('old', { k: 1 });
        const p = provider([haRow('ha:a-sensor'), haRow('ha:b-sensor')]);
        const l = (await setup({ providers: [p] }).source.get('old')).leftovers!;
        expect(l.entities.map(e => e.key)).toEqual(['ha:a-sensor', 'ha:b-sensor']);
        expect((p.storedEntities.mock.calls as any)[0][0].getValue('k')).toBe(1);
    });

    it('works for a dir that never got a store', async () => {
        fs.mkdirSync(path.join(envs(), 'bare'), { recursive: true });
        const l = (await setup().source.get('bare')).leftovers!;
        expect(l).toMatchObject({ storage: [], entities: [], destroyers: [], dir: { files: 0 } });
    });

    it('does not follow symlinks when measuring', async () => {
        await seed('old', {});
        const big = path.join(wd, 'big'); fs.mkdirSync(big); fs.writeFileSync(path.join(big, 'f'), 'x'.repeat(1000));
        fs.symlinkSync(big, path.join(envs(), 'old', 'link'));
        const l = (await setup().source.get('old')).leftovers!;
        expect(l.dir.bytes).toBeLessThan(1000);
    });
});

describe('hypervisorOrphanSource.cleanup', () => {
    it('hands the id to the hypervisor and rejects with its error', async () => {
        const { source, destroyed } = setup({ destroy: async id => { if (id === 'bad') throw new Error('HA down') } });
        await source.cleanup('old');
        expect(destroyed).toEqual(['old']);
        await expect(source.cleanup('bad')).rejects.toThrow('HA down');
    });
});

describe('hypervisorOrphanSource.onChange', () => {
    it('fires when an orphan was cleaned up, an app stopped or the config changed; stops after dispose', () => {
        const t = setup();
        const cb = jest.fn();
        const off = t.source.onChange('old', cb);
        t.events.emit('orphans_changed');
        t.events.emit('app_lifecycle', { id: 'old' }, 'stopped');
        t.fireConfig();
        expect(cb).toHaveBeenCalledTimes(3);
        off();
        t.events.emit('orphans_changed');
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('ignores lifecycle events of other apps', () => {
        const t = setup();
        const cb = jest.fn();
        t.source.onChange('old', cb);
        t.events.emit('app_lifecycle', { id: 'other' }, 'stopped');
        expect(cb).not.toHaveBeenCalled();
    });
});
