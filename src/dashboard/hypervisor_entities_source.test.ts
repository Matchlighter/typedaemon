import { appDirectory, persistenceFile } from '../hypervisor/app_paths';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../hypervisor/logging', () => ({ logMessage: jest.fn() }));

import { PersistentStorage } from '../hypervisor/persistent_storage';
import { hypervisorEntitiesSource, type EntitiesHost } from './hypervisor_entities_source';

let wd: string;
beforeEach(() => { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-entities-src-')) });
afterEach(() => fs.rmSync(wd, { recursive: true, force: true }));

const row = (key: string, over: any = {}) => ({ key, plugin: 'ha', domain: 'sensor', linked: true, autoClean: false, persistState: false, ...over });

async function seedOrphan(id: string) {
    const dir = path.join(wd, '.typedaemon', 'app_environments', id);
    fs.mkdirSync(dir, { recursive: true });
    await new PersistentStorage(path.join(dir, '.persistence.jkv')).dispose();
}

function setup(opts: { configured: string[] }) {
    const events = new EventEmitter();
    let cfgWatch: (() => void) | undefined;
    const provider = {
        appEntities: (app: any) => [row('ha:live', { entityId: `sensor.${app.id}` })],
        observeAppEntities: () => () => { },
        deleteUnlinkedEntity: async () => { },
        entityEvents: new EventEmitter(),
        storedEntities: () => [row('ha:left', { linked: false })],
    };
    const host = {
        working_directory: wd,
        operations_directory: path.join(wd, '.typedaemon'),
        defaultAppOperatingDirectory: (id: string) => appDirectory(path.join(wd, '.typedaemon'), id),
        defaultAppPersistenceFile: (id: string) => persistenceFile(appDirectory(path.join(wd, '.typedaemon'), id)),
        currentConfig: { apps: Object.fromEntries(opts.configured.map(id => [id, {}])) },
        getApplication: (id: string) => opts.configured.includes(id) ? { id } : undefined,
        listApplications: () => opts.configured.map(id => ({ id })),
        listPlugins: () => [{ id: 'ha', instance: provider }],
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
        watchConfigEntry: (_k: string, cb: () => void) => { cfgWatch = cb; return () => { cfgWatch = undefined } },
    } as unknown as EntitiesHost;
    return { source: hypervisorEntitiesSource(host), events, fireConfig: () => cfgWatch?.() };
}

describe('hypervisorEntitiesSource', () => {
    it('lists entities of configured apps and of orphans (from their leftovers)', async () => {
        await seedOrphan('old');
        const rows = await setup({ configured: ['a'] }).source.list();
        expect(rows.map(r => [r.key, r.app, !!r.orphan, r.linked])).toEqual([['a/ha:live', 'a', false, true], ['old/ha:left', 'old', true, false]]);
    });

    it('notifies on orphans_changed and on config changes', () => {
        const t = setup({ configured: ['a'] });
        const cb = jest.fn();
        t.source.onChange(cb);
        t.events.emit('orphans_changed');
        t.fireConfig();
        expect(cb).toHaveBeenCalledTimes(2);
    });
});
