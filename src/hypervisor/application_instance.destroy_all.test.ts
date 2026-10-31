import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('./logging', () => {
    const logger = { logMessage() { }, close() { } };
    return { createDomainLogger: () => logger, NUMERIC_LOG_LEVELS: {}, logMessage: jest.fn() };
});
jest.mock('./vm', () => ({ createApplicationVM: jest.fn(), determineModuleContext: jest.fn() }));
jest.mock('./sentry', () => ({ captureExceptionWithSourceMaps: jest.fn() }));

import { ApplicationInstance } from './application_instance';
import { DestroyerStore } from './destroyer';
import { PersistentStorage } from './persistent_storage';

const NOW = { min_time_to_disk: 0, max_time_to_disk: 0 };

let wd: string;
beforeEach(() => { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-destroy-all-')) });
afterEach(() => fs.rmSync(wd, { recursive: true, force: true }));

const opdir = () => path.join(wd, '.typedaemon', 'app_environments', 'gone');

/** An app that is not in the config, never started in this run: only its operating dir remains */
function makeOrphan() {
    const hypervisor: any = { working_directory: wd, operations_directory: path.join(wd, '.typedaemon'), defaultAppOperatingDirectory: (id: string) => path.join(wd, '.typedaemon', 'app_environments', id) };
    return new ApplicationInstance({ id: 'gone', hypervisor, namespace: {} as any }, { source: 'gone.ts', logging: {} } as any);
}

async function seedDestroyers(types: string[]) {
    fs.mkdirSync(opdir(), { recursive: true });
    const s = new PersistentStorage(path.join(opdir(), '.persistence.jkv'));
    for (const type of types) s.objectSet('_destroyers', type, { uuid: type, type, options: { n: 1 } }, NOW);
    await s.dispose();
}

describe('ApplicationInstance.run_destroyers (app that never started)', () => {
    it('runs the destroyers stored in its operating dir', async () => {
        const ran: any[] = [];
        DestroyerStore.defineDestroyerClass('DA-ok', async (_app, o: any) => { ran.push(o) });
        await seedDestroyers(['DA-ok']);
        const app = makeOrphan();
        await app.run_destroyers();
        await app._shutdown();
        expect(ran).toEqual([{ n: 1 }]);
    });

    it('rejects when a destroyer fails', async () => {
        DestroyerStore.defineDestroyerClass('DA-bad', async () => { throw new Error('nope') });
        await seedDestroyers(['DA-bad']);
        const app = makeOrphan();
        await expect(app.run_destroyers()).rejects.toThrow(/DA-bad.*nope/);
        await app._shutdown();
    });

    it('does nothing (and creates nothing) without an operating dir', async () => {
        await makeOrphan().run_destroyers();
        expect(fs.existsSync(opdir())).toBe(false);
    });
});
