import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appDirectory } from './app_paths';
import { destroyOrphan, listOrphanIds, orphanRemovedAt, recordRemoval, type OrphanHost } from './orphan_apps';

let wd: string;
beforeEach(() => { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-orphans-')) });
afterEach(() => fs.rmSync(wd, { recursive: true, force: true }));

const ops = () => path.join(wd, '.typedaemon');
const envs = () => path.join(ops(), 'app_environments');
const mk = (id: string, files: Record<string, string> = { 'a.txt': 'x' }) => {
    for (const [f, c] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(envs(), id, f)), { recursive: true });
        fs.writeFileSync(path.join(envs(), id, f), c);
    }
};

function setup(opts: { configured?: string[]; live?: string[] } = {}) {
    const events: string[] = [];
    const config = { apps: Object.fromEntries((opts.configured ?? []).map(id => [id, {}])) as Record<string, any> };
    const live = new Set(opts.live ?? []);
    const host = {
        operations_directory: ops(),
        currentConfig: config,
        listApplications: () => [...live].map(id => ({ id })),
        withApplicationExclusive: async (_id: string, fn: any) => { events.push('lock'); try { return await fn(undefined) } finally { events.push('unlock') } },
    } as unknown as OrphanHost;
    return { host, events, config };
}

describe('appDirectory', () => {
    it.each(['', '.', '..', 'a/b', '../x', 'a\\b', '/etc'])('rejects %j: it could point outside app_environments', id => {
        expect(() => appDirectory(ops(), id)).toThrow(/Invalid app id/);
    });
    it('is the default operating dir', () => {
        expect(appDirectory(ops(), 'old')).toBe(path.join(envs(), 'old'));
    });
});

describe('listOrphanIds', () => {
    it('lists directories that are not configured, nor live', async () => {
        mk('old'); mk('kept'); mk('running');
        fs.writeFileSync(path.join(envs(), 'stray-file'), '');
        const { host } = setup({ configured: ['kept'], live: ['running'] });
        expect(await listOrphanIds(host)).toEqual(['old']);
    });
    it('is empty without an app_environments dir', async () => {
        expect(await listOrphanIds(setup().host)).toEqual([]);
    });
});

describe('destroyOrphan', () => {
    it('runs the destroyers, then deletes only that app dir, all under exclusive access', async () => {
        mk('old'); mk('other');
        const { host, events } = setup();
        const dirDuring: boolean[] = [];
        await destroyOrphan(host, 'old', async () => { events.push('destroyers'); dirDuring.push(fs.existsSync(path.join(envs(), 'old'))) });
        expect(events).toEqual(['lock', 'destroyers', 'unlock']);
        expect(dirDuring).toEqual([true]);
        expect(fs.existsSync(path.join(envs(), 'old'))).toBe(false);
        expect(fs.existsSync(path.join(envs(), 'other', 'a.txt'))).toBe(true);
    });

    it('keeps the dir (and surfaces the error) when a destroyer fails', async () => {
        mk('old');
        await expect(destroyOrphan(setup().host, 'old', async () => { throw new Error('HA down') })).rejects.toThrow('HA down');
        expect(fs.existsSync(path.join(envs(), 'old', 'a.txt'))).toBe(true);
    });

    it.each([
        ['configured', { configured: ['old'] }],
        ['running', { live: ['old'] }],
    ])('refuses an app that is %s, touching nothing', async (_n, opts) => {
        mk('old');
        const run = jest.fn();
        await expect(destroyOrphan(setup(opts).host, 'old', run)).rejects.toThrow(/not an orphan/i);
        expect(run).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(envs(), 'old', 'a.txt'))).toBe(true);
    });

    it('keeps the dir if the app is added back to the config while the destroyers ran', async () => {
        mk('old');
        const { host, config } = setup();
        await expect(destroyOrphan(host, 'old', async () => { config.apps.old = {} })).rejects.toThrow(/added back/i);
        expect(fs.existsSync(path.join(envs(), 'old', 'a.txt'))).toBe(true);
    });

    it('refuses invalid ids and ids without a leftover dir', async () => {
        mk('old');
        const run = jest.fn();
        await expect(destroyOrphan(setup().host, '..', run)).rejects.toThrow(/Invalid app id/);
        await expect(destroyOrphan(setup().host, 'nothing', run)).rejects.toThrow(/No leftovers/);
        expect(run).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(envs(), 'old', 'a.txt'))).toBe(true);
    });

    it('does not follow a symlink standing in for the dir', async () => {
        const outside = path.join(wd, 'precious');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
        fs.mkdirSync(envs(), { recursive: true });
        fs.symlinkSync(outside, path.join(envs(), 'link'));
        const run = jest.fn();
        await expect(destroyOrphan(setup().host, 'link', run)).rejects.toThrow(/No leftovers/);
        expect(run).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    });
});

describe('orphan removal time', () => {
    it('is the recorded time, not the directory mtime', async () => {
        mk('old');
        const { host } = setup();
        await recordRemoval(host, 'old', 1234);
        fs.utimesSync(path.join(envs(), 'old'), 99, 99);
        expect(await orphanRemovedAt(host, 'old')).toBe(1234);
    });
    it('falls back to the directory mtime when nothing was recorded', async () => {
        mk('old');
        fs.utimesSync(path.join(envs(), 'old'), 100, 100);
        expect(await orphanRemovedAt(setup().host, 'old')).toBe(100_000);
    });
    it('recording without a directory is a no-op; reading without one is undefined', async () => {
        const { host } = setup();
        await recordRemoval(host, 'none');
        expect(await orphanRemovedAt(host, 'none')).toBeUndefined();
    });
});
