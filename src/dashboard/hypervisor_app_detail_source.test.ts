import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HttpRouteRegistry } from '../plugins/http/routes';
import { hypervisorAppDetailSource } from './hypervisor_app_detail_source';
import type { AppsHost } from './hypervisor_apps_source';

function setup(config: Record<string, any>, instances: any[] = [], wd = '/wd', plugins: any[] = []) {
    const events = new EventEmitter();
    const configWatchers: Array<() => void> = [];
    const host = {
        working_directory: wd, operations_directory: path.join(wd, '.typedaemon'), currentConfig: { apps: config },
        listApplications: () => instances,
        getApplication: (id: string) => instances.find(a => a.id === id),
        listPlugins: () => plugins,
        isApplicationStopped: () => false,
        on: (e: string, cb: any) => events.on(e, cb), off: (e: string, cb: any) => events.off(e, cb),
        watchConfigEntry: (_k: string, cb: () => void) => { configWatchers.push(cb); return () => { } },
    } as unknown as AppsHost;
    return { source: hypervisorAppDetailSource(host), events, config, configWatchers };
}

const inst = (over: any = {}) => ({
    id: 'lights', state: 'started', stateSince: 1, isThickApp: true, usedPlugins: new Set<string>(), resumableStore: Object.assign(new EventEmitter(), { list: () => [] as any[] }), scripts: Object.assign(new EventEmitter(), { list: () => [] as any[] }), schedules: Object.assign(new EventEmitter(), { list: () => [] as any[] }),
    options: { source: '/wd/apps/lights/index.ts', uuid: 'u-1', export: 'Lights', logging: { level: 'debug' }, dependencies: { dayjs: '^1' }, watch: { source: true, config: true } },
    ...over,
});

describe('hypervisorAppDetailSource', () => {
    it('describes a live app from its instance options', () => {
        const { source } = setup({ lights: {} }, [inst()]);
        expect(source.get('lights')).toMatchObject({
            row: { id: 'lights', state: 'started', kind: 'thick' },
            uuid: 'u-1', instanceOf: 'apps/lights/index.ts#Lights', logLevel: 'debug', packages: { dayjs: '^1' }, watching: true, counts: {},
        });
    });

    it('counts linked and unlinked entities', () => {
        const row = (linked: boolean) => ({ key: String(Math.random()), plugin: 'ha', domain: 'sensor', linked, autoClean: true, persistState: false });
        const provider = { appEntities: () => [row(true), row(true), row(false)], entityEvents: new EventEmitter() };
        const { source } = setup({ lights: {} }, [inst()], '/wd', [{ id: 'ha', instance: provider }]);
        expect(source.get('lights')!.counts).toMatchObject({ entities: 2, unlinkedEntities: 1 });
    });

    describe('resumable and script counts', () => {
        it('counts the listed resumables and the running script runs', () => {
            const resumableStore = Object.assign(new EventEmitter(), { list: () => [{}, {}] });
            const scripts = Object.assign(new EventEmitter(), { list: () => [{ running: 1 }, { running: 2 }] });
            const { source } = setup({ lights: {} }, [inst({ resumableStore, scripts })]);
            expect(source.get('lights')!.counts).toMatchObject({ resumables: 2, scripts: 3 });
        });

        it('notifies when a count changes, not on every change', () => {
            let rows: any[] = [{}];
            const resumableStore = Object.assign(new EventEmitter(), { list: () => rows });
            const { source } = setup({ lights: {} }, [inst({ resumableStore })]);
            const cb = jest.fn();
            source.onChange('lights', cb);
            resumableStore.emit('change');
            expect(cb).not.toHaveBeenCalled();
            rows = [{}, {}];
            resumableStore.emit('change');
            expect(cb).toHaveBeenCalledTimes(1);
        });
    });

    describe('schedule count', () => {
        it('counts the registered schedules', () => {
            const schedules = Object.assign(new EventEmitter(), { list: () => [{}, {}] });
            const { source } = setup({ lights: {} }, [inst({ schedules })]);
            expect(source.get('lights')!.counts.schedules).toBe(2);
        });

        it('notifies when the count changes, not when a schedule fires', () => {
            let rows: any[] = [{}];
            const schedules = Object.assign(new EventEmitter(), { list: () => rows });
            const { source } = setup({ lights: {} }, [inst({ schedules })]);
            const cb = jest.fn();
            source.onChange('lights', cb);
            schedules.emit('change');
            expect(cb).not.toHaveBeenCalled();
            rows = [{}, {}];
            schedules.emit('change');
            expect(cb).toHaveBeenCalledTimes(1);
        });
    });

    describe('overview summary', () => {
        it('reports the soonest pending schedule', () => {
            const schedules = Object.assign(new EventEmitter(), { list: () => [{ expression: 'b', nextAt: 20 }, { expression: 'a', nextAt: 10 }, { expression: 'c' }] });
            const { source } = setup({ lights: {} }, [inst({ schedules })]);
            expect(source.get('lights')!.summary!.nextSchedule).toEqual({ expression: 'a', at: 10 });
        });

        it('sizes user keys, counts internal ones and dates the newest write', () => {
            const s = Object.assign(new EventEmitter(), {
                keyBytes: (k: string) => (k === 'a' ? 4 : k === 'b' ? 1 : 1),
                keys: ['a', 'b', '_destroyers'], getValue: (k: string) => (k === 'a' ? 'xy' : k === 'b' ? 5 : 1),
                keyInfo: (k: string) => (k === 'a' ? { at: 7 } : k === 'b' ? { at: 9 } : { at: 99 }),
            });
            const { source } = setup({ lights: {} }, [inst({ persistedStorage: s })]);
            expect(source.get('lights')!.summary!.storage).toEqual({ bytes: 5, internal: 1, lastWriteAt: 9 });
        });

        it('names running scripts and totals queued runs', () => {
            const scripts = Object.assign(new EventEmitter(), { list: () => [{ name: 'fade', running: 1, queued: 2 }, { name: 'idle', running: 0, queued: 0 }] });
            const { source } = setup({ lights: {} }, [inst({ scripts })]);
            expect(source.get('lights')!.summary!.scripts).toEqual({ running: ['fade'], queued: 2 });
        });

        it('lists the plugins the instance used', () => {
            const { source } = setup({ lights: {} }, [inst({ usedPlugins: new Set(['ha', 'mqtt']) })]);
            expect(source.get('lights')!.summary!.dependsOn).toEqual(['ha', 'mqtt']);
        });
    });

    describe('storage count', () => {
        const store = (keys: string[]) => Object.assign(new EventEmitter(), { keys, getValue: () => 1, keyBytes(this: any, k: string) { return JSON.stringify(this.getValue(k)).length }, keyInfo: () => undefined as { at: number } | undefined });

        it('counts user keys of the open store', () => {
            const { source } = setup({ lights: {} }, [inst({ persistedStorage: store(['a', 'b', '_destroyers']) })]);
            expect(source.get('lights')!.counts.storage).toBe(2);
        });

        it('notifies when keys are added or removed, not on plain overwrites', () => {
            const s = store(['a']);
            const { source } = setup({ lights: {} }, [inst({ persistedStorage: s })]);
            const cb = jest.fn();
            source.onChange('lights', cb);
            s.emit('change', { type: 'set', key: 'a', internal: false });
            expect(cb).not.toHaveBeenCalled();
            s.keys.push('b');
            s.emit('change', { type: 'set', key: 'b', internal: false });
            expect(cb).toHaveBeenCalledTimes(1);
        });

        it('notifies when the stored size or the internal key count changes', () => {
            const s = store(['a']);
            const { source } = setup({ lights: {} }, [inst({ persistedStorage: s })]);
            const cb = jest.fn();
            source.onChange('lights', cb);
            s.getValue = () => 'longer';
            s.emit('change', { type: 'set', key: 'a', internal: false });
            expect(cb).toHaveBeenCalledTimes(1);
            s.keys.push('_x');
            s.emit('change', { type: 'set', key: '_x', internal: true });
            expect(cb).toHaveBeenCalledTimes(2);
        });
    });

    it('defaults uuid to the id and the export to default', () => {
        const { source } = setup({ lights: {} }, [inst({ options: { source: '/wd/a.ts' } })]);
        expect(source.get('lights')).toMatchObject({ uuid: 'lights', instanceOf: 'a.ts#default', packages: {}, watching: false });
    });

    it('describes a configured app without an instance from config', () => {
        const { source } = setup({ lights: { source: '/wd/apps/l.ts', dependencies: { x: '1' } } });
        expect(source.get('lights')).toMatchObject({ row: { state: 'stopped' }, instanceOf: 'apps/l.ts#default', packages: { x: '1' } });
    });

    it('includes parsed, source-mapped failure frames while dead', () => {
        const { source } = setup({ lights: {} }, [inst({
            state: 'dead',
            lastError: { message: 'boom', phase: 'starting', stack: ['    at Lights.init (/wd/apps/lights/index.ts:4:5)'] },
        })]);
        expect(source.get('lights').failure).toEqual({
            message: 'boom', phase: 'starting', frames: [{ fn: 'Lights.init', file: 'apps/lights/index.ts', line: 4, col: 5 }],
        });
    });

    it('links the failure to the log line that reported it', () => {
        const { source } = setup({ lights: {} }, [inst({ state: 'dead', lastError: { message: 'boom', phase: 'starting', logId: 7 } })]);
        expect(source.get('lights').failure!.logId).toBe(7);
        const { source: bare } = setup({ lights: {} }, [inst({ state: 'dead', lastError: { message: 'boom', phase: 'starting' } })]);
        expect(bare.get('lights').failure).not.toHaveProperty('logId');
    });

    it('adds a code frame for the first frame in the working directory', () => {
        const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'td-det-'));
        fs.mkdirSync(path.join(wd, 'apps'));
        fs.writeFileSync(path.join(wd, 'apps/x.ts'), 'a\nb\nc\n');
        const { source } = setup({ lights: {} }, [inst({
            state: 'dead',
            lastError: { message: 'boom', phase: 'starting', stack: [
                '    at internal (node:internal/x:1:1)', `    at Lights.init (${wd}/apps/x.ts:2:3)`, `    at dep (${wd}/node_modules/p/i.js:5:5)`] },
        })], wd);
        expect(source.get('lights').failure.codeFrame).toEqual({
            file: 'apps/x.ts', line: 2, col: 3, lines: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }],
        });
    });

    it('has no failure for a healthy app and returns undefined for unknown ids', () => {
        const { source } = setup({ lights: {} }, [inst()]);
        expect(source.get('lights').failure).toBeUndefined();
        expect(source.get('zzz')).toBeUndefined();
    });

    it('notifies only for the watched app', () => {
        const live = inst();
        const { source, events } = setup({ lights: {}, other: {} }, [live]);
        const cb = jest.fn();
        const off = source.onChange('lights', cb);
        events.emit('app_lifecycle', inst({ id: 'other' }), 'started');
        expect(cb).not.toHaveBeenCalled();
        live.state = 'stopping';
        events.emit('app_lifecycle', live, 'stopping');
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        events.emit('app_lifecycle', inst(), 'started');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('ignores config changes to other apps', () => {
        const { source, config, configWatchers } = setup({ lights: {}, other: {} }, [inst()]);
        const cb = jest.fn();
        source.onChange('lights', cb);
        config.other = { source: 'x.ts' };
        configWatchers.forEach(w => w());
        expect(cb).not.toHaveBeenCalled();
        config.lights = { source: 'y.ts' };
        configWatchers.forEach(w => w());
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not rebuild other apps\' rows or re-notify when its own row is unchanged', () => {
        const live = inst();
        const { source, events } = setup({ lights: {} }, [live]);
        const cb = jest.fn();
        source.onChange('lights', cb);
        events.emit('app_lifecycle', live, 'started');
        expect(cb).not.toHaveBeenCalled();
    });

    describe('http count', () => {
        const withRoutes = () => {
            const routes = new HttpRouteRegistry();
            return { routes, plugins: [{ id: 'http', instance: { routes, port: 9000 } }] };
        };

        it('counts the routes and static mounts the app registered', () => {
            const { routes, plugins } = withRoutes();
            routes.add({ appUuid: 'u-1', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
            const { source } = setup({ lights: { uuid: 'u-1' } }, [inst()], '/wd', plugins);
            expect(source.get('lights')!.counts.http).toBe(1);
        });

        it('leaves the count out without an HTTP plugin', () => {
            const { source } = setup({ lights: {} }, [inst()]);
            expect(source.get('lights')!.counts.http).toBeUndefined();
        });

        it('notifies when routes appear (app restart), not for other apps', () => {
            const { routes, plugins } = withRoutes();
            const { source } = setup({ lights: { uuid: 'u-1' } }, [inst()], '/wd', plugins);
            const cb = jest.fn();
            source.onChange('lights', cb);
            routes.add({ appUuid: 'other', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
            expect(cb).not.toHaveBeenCalled();
            routes.add({ appUuid: 'u-1', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
            expect(cb).toHaveBeenCalledTimes(1);
        });
    });
});
