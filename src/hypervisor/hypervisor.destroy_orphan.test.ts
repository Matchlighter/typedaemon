import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('./logging', () => {
    const logger = { logMessage() { }, close() { } };
    return { createDomainLogger: () => logger, NUMERIC_LOG_LEVELS: {}, logMessage: jest.fn(), ORIGINAL_CONSOLE: console, setFallbackLogger: jest.fn() };
});
jest.mock('./vm', () => ({ createApplicationVM: jest.fn(), determineModuleContext: jest.fn() }));
jest.mock('./sentry', () => ({ captureExceptionWithSourceMaps: jest.fn() }));

import { DestroyerStore } from './destroyer';
import { Hypervisor } from './hypervisor';
import { AppNamespace } from './managed_apps';
import { PersistentStorage } from './persistent_storage';

const NOW = { min_time_to_disk: 0, max_time_to_disk: 0 };

let wd: string;
beforeEach(() => { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-hyp-orphan-')) });
afterEach(() => fs.rmSync(wd, { recursive: true, force: true }));

const envs = () => path.join(wd, '.typedaemon', 'app_environments');
const dirOf = (id: string) => path.join(envs(), id);

async function seed(id: string, destroyerTypes: string[]) {
    fs.mkdirSync(dirOf(id), { recursive: true });
    const s = new PersistentStorage(path.join(dirOf(id), '.persistence.jkv'));
    s.setValue('mine', 1, NOW);
    for (const type of destroyerTypes) s.objectSet('_destroyers', type, { uuid: type, type, options: {} }, NOW);
    await s.dispose();
}

class FakeInstance extends EventEmitter {
    static started: string[] = [];
    state = 'initializing';
    constructor(public ctx: any, public options: any) { super(); this.id = ctx.id }
    id: string;
    async _start() { FakeInstance.started.push(this.id); this.state = 'started' }
    async _shutdown() { this.state = 'stopped' }
}

/** The real `destroyApplication` running on a minimal hypervisor over a real AppNamespace */
function setup(configured: Record<string, any> = {}) {
    FakeInstance.started = [];
    const emitted: string[] = [];
    const host: any = {
        operations_directory: path.join(wd, '.typedaemon'),
        working_directory: wd,
        currentConfig: { apps: configured, logging: {} },
        state: 'running',
        logMessage() { },
        emit: (e: string) => { emitted.push(e) },
    };
    const ns = new AppNamespace<any, any, any>(host, 'Application', { Host: FakeInstance as any, getInstanceConfig: id => ({ source: `${id}.ts` }) });
    host.appInstances = ns;
    host.listApplications = () => ns.listInstances();
    host.defaultAppOperatingDirectory = (id: string) => path.join(host.operations_directory, 'app_environments', id);
    host.transientDestroyInstance = (id: string) => (Hypervisor.prototype as any).transientDestroyInstance.call(host, id);
    host.withApplicationExclusive = (id: string, fn: any) => ns.withExclusiveAccess(id, fn);
    return { host, ns, emitted, run: (id: string) => Hypervisor.prototype.destroyApplication.call(host, id) as Promise<void> };
}

describe('Hypervisor.destroyApplication', () => {
    it('runs the stored destroyers, deletes the dir and announces the change', async () => {
        const ran: string[] = [];
        DestroyerStore.defineDestroyerClass('HY-ok', async () => { ran.push('ok') });
        await seed('old', ['HY-ok']); await seed('other', []);
        const t = setup();
        await t.run('old');
        expect(ran).toEqual(['ok']);
        expect(fs.existsSync(dirOf('old'))).toBe(false);
        expect(fs.existsSync(dirOf('other'))).toBe(true);
        expect(t.emitted).toEqual(['orphans_changed']);
    });

    it('keeps the dir (and its registry), announces nothing, when a destroyer fails', async () => {
        DestroyerStore.defineDestroyerClass('HY-bad', async () => { throw new Error('HA down') });
        await seed('old', ['HY-bad']);
        const t = setup();
        await expect(t.run('old')).rejects.toThrow(/HY-bad.*HA down/);
        expect(t.emitted).toEqual([]);
        const s = new PersistentStorage(path.join(dirOf('old'), '.persistence.jkv'));
        await s.load();
        expect(s.getValue('mine')).toBe(1);
        expect(Object.keys(s.getValue('_destroyers'))).toEqual(['HY-bad']);
    });

    it('keeps the dir and errors when the app is added back to the config meanwhile', async () => {
        const config: Record<string, any> = {};
        DestroyerStore.defineDestroyerClass('HY-readd', async () => { config.old = { source: 'old.ts' } });
        await seed('old', ['HY-readd']);
        const t = setup(config);
        await expect(t.run('old')).rejects.toThrow(/added back/);
        expect(fs.existsSync(path.join(dirOf('old'), '.persistence.jkv'))).toBe(true);
        expect(t.emitted).toEqual([]);
    });

    it('refuses a symlink standing in for the dir', async () => {
        const outside = path.join(wd, 'precious');
        fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep'), 'k');
        fs.mkdirSync(envs(), { recursive: true });
        fs.symlinkSync(outside, dirOf('link'));
        await expect(setup().run('link')).rejects.toThrow(/No leftovers/);
        expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('k');
    });

    it.each(['', '.', '..', 'a/b', 'a\\b', '../x'])('rejects the id %j without touching anything', async id => {
        await seed('old', []);
        await expect(setup().run(id)).rejects.toThrow(/Invalid app id/);
        expect(fs.existsSync(dirOf('old'))).toBe(true);
    });

    it('holds exclusive access: a start requested meanwhile waits until the cleanup is done', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r });
        let inside!: () => void;
        const entered = new Promise<void>(r => { inside = r });
        DestroyerStore.defineDestroyerClass('HY-slow', async () => { inside(); await gate });
        await seed('old', ['HY-slow']);
        const t = setup();
        const cleanup = t.run('old');
        await entered;
        const start = t.ns.startInstance('old');
        await new Promise(r => setTimeout(r, 30));
        expect(FakeInstance.started).toEqual([]);
        release();
        // The start was requested while we ran: the app is no orphan anymore, so the dir stays
        await expect(cleanup).rejects.toThrow(/not an orphan|added back/);
        await start;
        expect(FakeInstance.started).toEqual(['old']);
        expect(fs.existsSync(path.join(dirOf('old'), '.persistence.jkv'))).toBe(true);
    });
});
