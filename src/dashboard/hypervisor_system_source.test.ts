import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../hypervisor/logging', () => ({ logMessage: jest.fn() }));

import { PersistentStorage } from '../hypervisor/persistent_storage';
import { SharedStorages } from '../hypervisor/persistent_storage';
import { hypervisorSystemSource, type SystemHost } from './hypervisor_system_source';

const NOW = { min_time_to_disk: 0, max_time_to_disk: 0 };

let dir: string;
let shared: SharedStorages;
beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-dash-sysinfo-'));
    shared = new SharedStorages(path.join(dir, '.typedaemon', 'shared_storage'));
    fs.mkdirSync(shared.root_directory, { recursive: true });
    await shared.initialize();
});
afterEach(async () => {
    await shared.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
});

function setup(over: { calls?: any[]; apps?: { id: string; state: string }[]; state?: string; config?: any; plugins?: any[] } = {}) {
    const events = new EventEmitter();
    const callChange = new EventEmitter();
    const cancelled: string[] = [];
    const host = {
        state: over.state ?? 'running',
        configFile: '/etc/td/typedaemon.yaml',
        working_directory: dir,
        currentConfig: over.config ?? { location: { timezone: 'Europe/Paris' } },
        sharedStorages: shared,
        crossCallStore: {
            cancelCall: (uuid: string) => cancelled.push(uuid),
            listCalls: () => over.calls ?? [],
            onChange: (cb: () => void) => { callChange.on('c', cb); return () => callChange.off('c', cb) },
        },
        listApplications: () => over.apps ?? [],
        listPlugins: () => over.plugins ?? [],
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
    } as unknown as SystemHost;
    return { host, source: hypervisorSystemSource(host), events, callChange, cancelled };
}

describe('hypervisorSystemSource', () => {
    it('reports state, config path and location', async () => {
        const { source } = setup({ config: { location: { timezone: 'Europe/Paris', latitude: 1 } } });
        expect(await source.get(false)).toMatchObject({ state: 'running', configPath: '/etc/td/typedaemon.yaml', location: { timezone: 'Europe/Paris', latitude: 1 } });
    });

    it('reports the resolved config with plugins/apps as ids and secrets hidden', async () => {
        const { source } = setup({ config: { location: { timezone: 'UTC' }, dashboard: { token: 'hunter2' }, plugins: { mqtt: { password: 'x' } }, apps: { lights: {}, hvac: {} } } });
        const { resolvedConfig } = await source.get(false);
        expect(resolvedConfig).toMatchObject({ location: { timezone: 'UTC' }, plugins: ['mqtt'], apps: ['lights', 'hvac'] });
        expect(JSON.stringify(resolvedConfig)).not.toContain('hunter2');
    });

    it('reports which apps accessed each shared store', async () => {
        shared.noteUse('default', 'lights');
        shared.noteUse('default', 'hvac');
        shared.noteUse('default', 'lights');
        const { source } = setup();
        expect((await source.get(true)).stores![0].usedBy).toEqual(['hvac', 'lights']);
    });

    it('lists each shared store with its path and rows', async () => {
        shared.primary.setValue('greeting', 'hi', NOW);
        const { source } = setup();
        const info = await source.get(true);
        expect(info.stores).toHaveLength(1);
        expect(info.stores![0]).toMatchObject({ name: 'default', path: path.join('.typedaemon', 'shared_storage', 'default.jkv') });
        expect(info.stores![0].rows).toEqual([expect.objectContaining({ key: 'greeting', value: 'hi', internal: false })]);
    });

    it('omits the shared stores unless asked', async () => {
        shared.primary.setValue('greeting', 'hi', NOW);
        const { source } = setup();
        expect(await source.get(false)).not.toHaveProperty('stores');
    });

    it('maps calls to rows with the target app state; unknown target has none', async () => {
        const { source } = setup({
            apps: [{ id: 'b', state: 'dead' }, { id: 'a', state: 'started' }],
            calls: [
                { uuid: 'u1', source_app: 'a', target_app: 'b', method: 'ping', status: 'pending', created_at: 5, start_by: 99, parameters: ['hi', { n: 1 }] },
                { uuid: 'u2', source_app: 'a', target_app: 'gone', method: 'x', status: 'started' },
            ],
        });
        expect((await source.get(false)).crossCalls).toEqual([
            { uuid: 'u1', source: 'a', target: 'b', method: 'ping', status: 'pending', since: 5, timeoutAt: 99, targetState: 'dead', args: '"hi", {"n":1}' },
            { uuid: 'u2', source: 'a', target: 'gone', method: 'x', status: 'started' },
        ]);
    });

    it('cancelCall delegates to the call store', () => {
        const { source, cancelled } = setup();
        source.cancelCall('u1');
        expect(cancelled).toEqual(['u1']);
    });

    it('onChange fires for shared-store writes, call changes and app lifecycle; disposer detaches all', async () => {
        const { source, events, callChange } = setup();
        const cb = jest.fn();
        const off = source.onChange(cb);
        shared.primary.setValue('k', 1, NOW);
        expect(cb).toHaveBeenCalledTimes(1);
        callChange.emit('c');
        events.emit('app_lifecycle');
        expect(cb).toHaveBeenCalledTimes(3);
        off();
        shared.primary.setValue('k', 2, NOW);
        callChange.emit('c');
        events.emit('app_lifecycle');
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('carries the HA base URL; a connection change of a plugin is a change', async () => {
        const connectionEvents = new EventEmitter();
        const instance = { haBaseUrl: undefined as string | undefined, connectionEvents };
        const { source } = setup({ plugins: [{ options: { type: 'home_assistant' }, instance }] });
        expect(await source.get(false)).not.toHaveProperty('haBaseUrl');
        const cb = jest.fn();
        const off = source.onChange(cb);
        instance.haBaseUrl = 'https://ha.example.com';
        connectionEvents.emit('change');
        expect(cb).toHaveBeenCalledTimes(1);
        expect(await source.get(false)).toMatchObject({ haBaseUrl: 'https://ha.example.com' });
        off();
        connectionEvents.emit('change');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('value fetches a key of a shared store', async () => {
        shared.primary.setValue('big', { a: 1 }, NOW);
        const { source } = setup();
        expect(await source.value('default', 'big')).toEqual({ a: 1 });
        await expect(source.value('default', 'nope')).rejects.toThrow("No key 'nope'");
        await expect(source.value('nostore', 'k')).rejects.toThrow('Unknown shared store');
    });
});
