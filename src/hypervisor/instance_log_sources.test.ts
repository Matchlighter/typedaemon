import * as os from 'os';
import * as path from 'path';

const created: any[] = [];
jest.mock('./logging', () => ({
    createDomainLogger: (opts: any) => { created.push(opts); return { logMessage() { }, close() { } } },
    NUMERIC_LOG_LEVELS: {},
}));
jest.mock('./vm', () => ({ createApplicationVM: jest.fn(), determineModuleContext: jest.fn() }));
jest.mock('./sentry', () => ({ captureExceptionWithSourceMaps: jest.fn() }));

import { ApplicationInstance } from './application_instance';
import { PluginInstance } from './plugin_instance';

const hypervisor: any = { working_directory: os.tmpdir(), operations_directory: path.join(os.tmpdir(), '.td-test'), defaultAppOperatingDirectory: (id: string) => path.join(os.tmpdir(), '.td-test', 'app_environments', id) };
const ctx = (id: string) => ({ id, hypervisor, namespace: {} as any });
const summary = () => created.map(o => [o.source, o.channel]);

describe('instance loggers declare their source (so the dashboard can tap them)', () => {
    beforeEach(() => { created.length = 0 });

    it('an app has a manager and a user logger', () => {
        new ApplicationInstance(ctx('lights'), { source: 'a.ts', watch: {} } as any);
        expect(summary()).toEqual([[{ kind: 'app', id: 'lights' }, 'manager'], [{ kind: 'app', id: 'lights' }, 'user']]);
    });

    it('a plugin has a manager and a user logger', () => {
        new PluginInstance(ctx('ha'), { type: 'home_assistant', logging: {} } as any);
        expect(summary()).toEqual([[{ kind: 'plugin', id: 'ha' }, 'manager'], [{ kind: 'plugin', id: 'ha' }, 'user']]);
    });
});
