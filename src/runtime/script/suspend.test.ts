import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const app: any = {};
jest.mock('../../hypervisor/current', () => ({ current: { get application() { return app; } } }));
jest.mock('../../hypervisor/logging', () => ({ logMessage: jest.fn(), logPluginClientMessage: jest.fn() }));

import { flushPluginAnnotations } from '../../plugins/base';
import { script } from './index';
import { ResumableScriptStoreManager } from './resumable';

function setupApp() {
    const locals = new Map();
    Object.assign(app, {
        operating_directory: fs.mkdtempSync(path.join(os.tmpdir(), 'script-suspend-')),
        cleanups: { append: jest.fn() },
        getLocalStore: (k: any, f: () => any) => { if (!locals.has(k)) locals.set(k, f()); return locals.get(k); },
        scripts: { define: jest.fn(), attach: jest.fn(), detach: jest.fn() },
    });
}

/** Decorate a method the way TS does, and run its initializers against `instance` */
function decorateMethod(options: any, name: string) {
    const initializers: Function[] = [];
    const context = { kind: 'method', name, addInitializer: (f: Function) => initializers.push(f) } as any;
    script(options)(function* () { }, context);
    const instance = {};
    initializers.forEach(f => f.call(instance));
    return instance;
}

describe("script({ shutdown: 'suspend' })", () => {
    beforeEach(setupApp);

    it('defines its sub-store when the application flushes plugin annotations', async () => {
        const instance = decorateMethod({ mode: 'single', shutdown: 'suspend' }, 'my_script');
        await flushPluginAnnotations(instance);
        expect(() => ResumableScriptStoreManager.current().lookupStore('my_script', '-')).not.toThrow();
    });
});
