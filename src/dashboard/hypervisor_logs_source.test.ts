import { LogTap } from '../hypervisor/log_tap';
import { hypervisorLogsSource, toLogRow } from './hypervisor_logs_source';

const WD = '/work';
const rec = (over: any = {}) => ({ id: 7, ts: 5, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: 'hi', ...over });

describe('toLogRow', () => {
    it('keeps plain lines as they are', () => {
        expect(toLogRow(rec(), WD)).toEqual({ id: 7, ts: 5, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: 'hi' });
    });

    it('maps logger levels to the dashboard\'s: lifecycle/warn/error/debug/info stay, console `dir` and the verbose ones become debug', () => {
        const lvl = (level: string) => toLogRow(rec({ level }), WD).level;
        expect(['debug', 'info', 'warn', 'error', 'lifecycle'].map(lvl)).toEqual(['debug', 'info', 'warn', 'error', 'lifecycle']);
        expect(['dir', 'http', 'verbose', 'silly'].map(lvl)).toEqual(['debug', 'debug', 'debug', 'debug']);
        expect(lvl('mystery')).toBe('info');
    });

    it('splits a stack trace off the message into frames (relative to the working directory)', () => {
        const message = 'Error: boom\ncontext line\n    at Lights.run (/work/apps/lights/index.ts:42:17)\n    at /work/apps/util.ts:3:1';
        expect(toLogRow(rec({ level: 'error', message }), WD)).toMatchObject({
            message: 'Error: boom\ncontext line',
            stack: [{ fn: 'Lights.run', file: 'apps/lights/index.ts', line: 42, col: 17 }, { file: 'apps/util.ts', line: 3, col: 1 }],
        });
    });

    it('leaves multi-line messages without frames whole', () => {
        const r = toLogRow(rec({ message: 'a\nb' }), WD);
        expect(r.message).toBe('a\nb');
        expect(r.stack).toBeUndefined();
    });
});

describe('hypervisorLogsSource', () => {
    it('serves history and the live feed from the tap, as dashboard rows', () => {
        const tap = new LogTap();
        const source = hypervisorLogsSource({ working_directory: WD }, tap);
        tap.append({ ts: 1, level: 'dir', source: { kind: 'app', id: 'a' }, channel: 'user', message: 'old' });
        tap.append({ ts: 2, level: 'info', source: { kind: 'app', id: 'b' }, channel: 'user', message: 'other' });
        expect(source.history({ sources: [{ kind: 'app', id: 'a' }] }).map(r => [r.message, r.level])).toEqual([['old', 'debug']]);
        expect(source.history({ limit: 1 }).map(r => r.message)).toEqual(['other']);

        const seen: string[] = [];
        const off = source.onAppend({ sources: [{ kind: 'app', id: 'a' }] }, r => seen.push(r.message));
        tap.append({ ts: 3, level: 'info', source: { kind: 'app', id: 'b' }, channel: 'user', message: 'nope' });
        tap.append({ ts: 4, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: 'yes' });
        off();
        tap.append({ ts: 5, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: 'late' });
        expect(seen).toEqual(['yes']);
    });
});
