import * as os from 'os';
import * as path from 'path';

jest.mock('./logging', () => {
    // Stand-in for the real loggers: the app's lines land in the process-wide tap, as with a `source`d domain logger
    const { logTap } = jest.requireActual('./log_tap');
    const logger = { logMessage(level: string, rest: any[]) { logTap.append({ ts: 1, level, source: { kind: 'app', id: 'x' }, channel: 'user', message: rest.join(' ') }) }, close() { } };
    return { createDomainLogger: () => logger, NUMERIC_LOG_LEVELS: {} };
});
jest.mock('./vm', () => ({ createApplicationVM: jest.fn(), determineModuleContext: jest.fn() }));
jest.mock('./sentry', () => ({ captureExceptionWithSourceMaps: jest.fn() }));

import { ApplicationInstance } from './application_instance';
import { logTap } from './log_tap';

function makeApp(source: string) {
    const wd = os.tmpdir();
    const hypervisor: any = { working_directory: wd, operations_directory: path.join(wd, '.td-test'), defaultAppOperatingDirectory: (id: string) => path.join(wd, '.td-test', 'app_environments', id) };
    return new ApplicationInstance({ id: 'x', hypervisor, namespace: {} as any }, { source, watch: {} } as any);
}

describe('instance status (for the dashboard)', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());

    it('stateSince tracks the time of the last lifecycle transition', async () => {
        jest.setSystemTime(1000);
        const app = makeApp('missing.ts');
        expect(app.stateSince).toBe(1000);
        jest.setSystemTime(5000);
        await app._start().catch(() => { });
        expect(app.state).toBe('dead');
        expect(app.stateSince).toBe(5000);
    });

    it('records why and in which phase startup failed', async () => {
        const app = makeApp('missing.ts');
        await app._start().catch(() => { });
        expect(app.lastError.message).toMatch(/entrypoint .*missing\.ts.* not found/);
        expect(app.lastError.phase).toBe('initializing');
    });

    it('remembers the log line that reported the failure, not an older error', async () => {
        logTap.append({ ts: 1, level: 'error', source: { kind: 'app', id: 'x' }, channel: 'user', message: 'earlier, unrelated' });
        const app = makeApp('missing.ts');
        await app._start().catch(() => { });
        const record = logTap.history({ sources: [{ kind: 'app', id: 'x' }] }).find(r => r.id === app.lastError.logId)!;
        expect(record.level).toBe('error');
        expect(record.message).toMatch(/Failed while starting up/);
    });

    it('keeps the stack as source-mapped lines, without the message line', async () => {
        const app = makeApp('missing.ts');
        await app._start().catch(() => { });
        const { stack } = app.lastError;
        expect(stack.length).toBeGreaterThan(0);
        expect(stack.every(l => /^\s*at /.test(l))).toBe(true);
    });

    it('has no error before anything failed', () => {
        expect(makeApp('missing.ts').lastError).toBeUndefined();
    });
});
