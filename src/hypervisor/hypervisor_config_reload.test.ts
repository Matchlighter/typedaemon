import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('./logging', () => ({ createDomainLogger: () => ({ logMessage() { }, close() { } }), NUMERIC_LOG_LEVELS: {} }));
jest.mock('./sentry', () => ({ captureExceptionWithSourceMaps: jest.fn() }));
jest.mock('./vm', () => ({ createApplicationVM: jest.fn(), determineModuleContext: jest.fn() }));

import { Hypervisor } from './hypervisor';

function setup(cleared: string[]) {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-reload-'));
    fs.mkdirSync(path.join(wd, 'apps'));
    fs.writeFileSync(path.join(wd, 'apps/a.ts'), '');
    const file = path.join(wd, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ apps: { a: { source: 'apps/a.ts' } } }));
    const h = new Hypervisor({ working_directory: wd, no_watching: true }) as any;
    h.appInstances = { clearOverrides: jest.fn(() => cleared), sync: jest.fn() };
    return { h, file };
}

describe('Hypervisor config reload and stop overrides', () => {
    it('clears overrides only for apps whose config entry changed, without an extra sync', async () => {
        const { h, file } = setup(['a']);
        await h.readAndWatchConfig(file);
        h.appInstances.clearOverrides.mockClear();
        fs.writeFileSync(file, JSON.stringify({ apps: { a: { source: 'apps/a.ts', config: { x: 1 } }, b: { source: 'apps/a.ts' } } }));
        await h.readAndWatchConfig(file);
        expect(h.appInstances.clearOverrides).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']));
        expect(h.appInstances.sync).not.toHaveBeenCalled();
    });

    it('keeps overrides on an unrelated reload', async () => {
        const { h, file } = setup([]);
        await h.readAndWatchConfig(file);
        h.appInstances.clearOverrides.mockClear();
        fs.writeFileSync(file, JSON.stringify({ apps: { a: { source: 'apps/a.ts' } }, location: { timezone: 'UTC' } }));
        await h.readAndWatchConfig(file);
        expect(h.appInstances.clearOverrides).toHaveBeenCalledWith([]);
    });

    it('clears the override of a removed app', async () => {
        const { h, file } = setup([]);
        await h.readAndWatchConfig(file);
        h.appInstances.clearOverrides.mockClear();
        fs.writeFileSync(file, JSON.stringify({ apps: {} }));
        await h.readAndWatchConfig(file);
        expect(h.appInstances.clearOverrides).toHaveBeenCalledWith(['a']);
    });
});

describe('Hypervisor config introspection', () => {
    it('exposes the config file path and each app\'s raw (pre-defaults) config', async () => {
        const { h, file } = setup([]);
        await h.readAndWatchConfig(file);
        expect(h.configFile).toBe(file);
        expect(h.rawAppConfig('a')).toEqual({ source: 'apps/a.ts' });
        expect(h.rawAppConfig('nope')).toBeUndefined();
    });

    it('refreshes the raw config on reload', async () => {
        const { h, file } = setup([]);
        await h.readAndWatchConfig(file);
        fs.writeFileSync(file, JSON.stringify({ apps: { a: { source: 'apps/a.ts', config: { x: 1 } } } }));
        await h.readAndWatchConfig(file);
        expect(h.rawAppConfig('a')).toEqual({ source: 'apps/a.ts', config: { x: 1 } });
    });
});
