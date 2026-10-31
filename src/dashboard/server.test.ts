import { appDirectory, persistenceFile } from '../hypervisor/app_paths';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import * as http from 'http';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { HttpRouteRegistry } from '../plugins/http/routes';
import { ScheduleRegistry } from '../runtime/schedule/registry';
import { mountDashboard } from './server';
import { startDashboardListener } from './listener';

const minimalHost = (): any => ({
    working_directory: '/wd', operations_directory: '/nonexistent/.typedaemon', currentConfig: { apps: {} },
    listApplications: () => [], listPlugins: () => [], getApplication: () => undefined, withApplicationExclusive: async (_id: string, fn: any) => fn(undefined), isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
    restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
    state: 'running', sharedStorages: { list: () => [], on() { }, off() { } }, crossCallStore: { listCalls: () => [], onChange: () => () => { } },
});

const firstMessage = (url: string, topic: string) => new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic })));
    ws.on('message', d => { ws.close(); resolve(JSON.parse(d.toString())) });
    ws.on('error', reject);
});

describe('dashboard mounts', () => {
    it('can be mounted twice (independent registries), even concurrently', async () => {
        const mk = async () => {
            const server = createServer();
            const app = express();
            server.on('request', app);
            const unmount = mountDashboard(server, app, minimalHost());
            await new Promise<void>(r => server.listen(0, r));
            return { server, unmount, port: (server.address() as AddressInfo).port };
        };
        const a = await mk();
        const b = await mk();
        expect(await firstMessage(`ws://127.0.0.1:${a.port}/ws`, 'system')).toMatchObject({ type: 'snapshot' });
        expect(await firstMessage(`ws://127.0.0.1:${b.port}/ws`, 'system')).toMatchObject({ type: 'snapshot' });
        a.unmount(); b.unmount();
        for (const m of [a, b]) { m.server.closeAllConnections(); await new Promise(r => m.server.close(r)) }
    });
});

describe('startDashboardListener', () => {
    it('serves /ws on its own port without any http plugin, and disposes', async () => {
        const listener = await startDashboardListener(minimalHost(), { port: 0, token: 't' });
        expect(listener.port).toBeGreaterThan(0);
        expect(await firstMessage(`ws://127.0.0.1:${listener.port}/ws?token=t`, 'system')).toMatchObject({ type: 'snapshot' });
        await listener.dispose();
        await expect(firstMessage(`ws://127.0.0.1:${listener.port}/ws?token=t`, 'system')).rejects.toBeDefined();
    });
});

describe('startDashboardListener access control', () => {
    const get = (port: number, headers: Record<string, string> = {}, path = '/') => new Promise<number>((resolve, reject) =>
        http.get({ host: '127.0.0.1', port, path, headers }, r => { r.resume(); resolve(r.statusCode!) }).on('error', reject));
    const wsOutcome = (url: string, headers: Record<string, string> = {}) => new Promise<'open' | 'rejected'>(resolve => {
        const ws = new WebSocket(url, { headers });
        ws.on('open', () => { ws.close(); resolve('open') });
        ws.on('error', () => resolve('rejected'));
    });

    it('rejects non-ingress http and ws when no token is configured', async () => {
        const l = await startDashboardListener(minimalHost(), { port: 0 });
        expect(await get(l.port)).toBe(403);
        expect(await wsOutcome(`ws://127.0.0.1:${l.port}/ws`)).toBe('rejected');
        await l.dispose();
    });

    it('token grants http and ws access; wrong token and mismatched Origin do not', async () => {
        const l = await startDashboardListener(minimalHost(), { port: 0, token: 'sekret' });
        const bearer = { Authorization: 'Bearer sekret' };
        expect(await get(l.port, bearer)).not.toBe(403);
        expect(await get(l.port, { Authorization: 'Bearer wrong' })).toBe(403);
        expect(await wsOutcome(`ws://127.0.0.1:${l.port}/ws`, bearer)).toBe('open');
        expect(await wsOutcome(`ws://127.0.0.1:${l.port}/ws?token=wrong`)).toBe('rejected');
        expect(await wsOutcome(`ws://127.0.0.1:${l.port}/ws`, { ...bearer, Origin: 'http://evil.example' })).toBe('rejected');
        expect(await wsOutcome(`ws://127.0.0.1:${l.port}/ws`, { ...bearer, Origin: `http://127.0.0.1:${l.port}` })).toBe('open');
        await l.dispose();
    });
});

describe('dashboard token session cookie', () => {
    it('GET /?token= sets a cookie that alone authorizes assets and /ws', async () => {
        const l = await startDashboardListener(minimalHost(), { port: 0, token: 'x' });
        const status = (path: string, headers: Record<string, string> = {}) => new Promise<http.IncomingMessage>((resolve, reject) =>
            http.get({ host: '127.0.0.1', port: l.port, path, headers }, r => { r.resume(); resolve(r) }).on('error', reject));
        const first = await status('/?token=x');
        const setCookie = first.headers['set-cookie']![0];
        expect(setCookie).toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/SameSite=Strict/);
        const cookie = setCookie.split(';')[0];
        expect((await status('/assets/none.js')).statusCode).toBe(403);
        expect((await status('/assets/none.js', { Cookie: cookie })).statusCode).not.toBe(403);
        const ws = new WebSocket(`ws://127.0.0.1:${l.port}/ws`, { headers: { Cookie: cookie } });
        await new Promise<void>((resolve, reject) => { ws.on('open', () => { ws.close(); resolve() }); ws.on('error', reject) });
        await l.dispose();
    });
});

describe('mountDashboard (real http + ws)', () => {
    let server: Server;
    let unmount: () => void;
    let port: number;

    beforeEach(async () => {
        server = createServer();
        const app = express();
        server.on('request', app);
        unmount = mountDashboard(server, app, minimalHost());
        await new Promise<void>(r => server.listen(0, r));
        port = (server.address() as AddressInfo).port;
    });
    afterEach(async () => {
        unmount();
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    });

    it('round-trips a system topic snapshot over /ws', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msg = await new Promise<any>((resolve, reject) => {
            ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'system' })));
            ws.on('message', d => resolve(JSON.parse(d.toString())));
            ws.on('error', reject);
        });
        ws.close();
        expect(msg).toMatchObject({ type: 'snapshot', id: 1, data: { version: expect.any(String), startedAt: expect.any(Number), now: expect.any(Number), state: 'running', crossCalls: [] } });
    });

    it('serves the apps topic when mounted with a hypervisor', async () => {
        unmount();
        const host: any = {
            working_directory: '/wd', operations_directory: '/nonexistent/.typedaemon', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [], listPlugins: () => [], getApplication: () => undefined, withApplicationExclusive: async (_id: string, fn: any) => fn(undefined), isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msg = await new Promise<any>((resolve, reject) => {
            ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'apps' })));
            ws.on('message', d => resolve(JSON.parse(d.toString())));
            ws.on('error', reject);
        });
        ws.close();
        expect(msg).toMatchObject({ type: 'snapshot', data: { apps: [{ id: 'a', state: 'stopped' }], orphans: [] } });
    });

    it('serves the app topic and app actions when mounted with a hypervisor', async () => {
        unmount();
        const restarted: string[] = [];
        const host: any = {
            working_directory: '/wd', operations_directory: '/nonexistent/.typedaemon', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [], listPlugins: () => [], getApplication: () => undefined, withApplicationExclusive: async (_id: string, fn: any) => fn(undefined), isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async (id: string) => { restarted.push(id) },
            stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'app', params: { id: 'a' } }));
        ws.send(JSON.stringify({ type: 'call', id: 2, action: 'app.restart', params: { id: 'a' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 2) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual(expect.arrayContaining([
            { type: 'snapshot', id: 1, data: expect.objectContaining({ row: expect.objectContaining({ id: 'a', state: 'stopped' }), uuid: 'a' }) },
            { type: 'result', id: 2, ok: true },
        ]));
        expect(restarted).toEqual(['a']);
    });

    it('serves the appEntities topic and the entity.delete action', async () => {
        unmount();
        const deleted: any[] = [];
        const app = { id: 'a' };
        const provider = {
            appEntities: () => [{ key: 'ha:x-sensor', plugin: 'ha', domain: 'sensor', linked: false, autoClean: true, persistState: false }],
            observeAppEntities: () => () => { }, entityEvents: { on() { }, off() { } },
            deleteUnlinkedEntity: async (a: any, cuid: string) => { deleted.push([a.id, cuid]) },
        };
        const host: any = {
            working_directory: '/wd', operations_directory: '/nonexistent/.typedaemon', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [], listPlugins: () => [{ id: 'ha', instance: provider }], getApplication: () => app,
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appEntities', params: { id: 'a' } }));
        ws.send(JSON.stringify({ type: 'call', id: 2, action: 'entity.delete', params: { app: 'a', key: 'ha:x-sensor' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 2) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual(expect.arrayContaining([
            { type: 'snapshot', id: 1, data: { rows: [expect.objectContaining({ key: 'ha:x-sensor', linked: false })] } },
            { type: 'result', id: 2, ok: true },
        ]));
        expect(deleted).toEqual([['a', 'x-sensor']]);
    });

    it('serves the appStorage topic, lazy value fetches and storage.delete', async () => {
        unmount();
        const ops = fs.mkdtempSync(path.join(os.tmpdir(), 'td-server-storage-'));
        const file = path.join(ops, 'app_environments', 'a', '.persistence.jkv');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'SET {"k":{"n":1}}\n');
        const host: any = {
            working_directory: ops, operations_directory: ops, defaultAppOperatingDirectory: (id: string) => appDirectory(ops, id), defaultAppPersistenceFile: (id: string) => persistenceFile(appDirectory(ops, id)), currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [], listPlugins: () => [], getApplication: () => undefined, withApplicationExclusive: async (_id: string, fn: any) => fn(undefined),
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appStorage', params: { id: 'a' } }));
        ws.send(JSON.stringify({ type: 'call', id: 2, action: 'storage.value', params: { app: 'a', key: 'k' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 2) { clearInterval(t); r() } }, 5) });
        ws.send(JSON.stringify({ type: 'call', id: 3, action: 'storage.delete', params: { app: 'a', key: 'k' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 3) { clearInterval(t); r() } }, 5) });
        ws.close();
        fs.rmSync(ops, { recursive: true, force: true });
        expect(msgs).toEqual(expect.arrayContaining([
            { type: 'snapshot', id: 1, data: { path: path.join('app_environments', 'a', '.persistence.jkv'), rows: [expect.objectContaining({ key: 'k', value: { n: 1 } })] } },
            { type: 'result', id: 2, ok: true, data: { n: 1 } },
            { type: 'result', id: 3, ok: true },
        ]));
    });

    it('serves the appResumables topic and its cancel/discard actions', async () => {
        unmount();
        const store = Object.assign(new (require('events').EventEmitter)(), {
            list: () => [{ id: 4, status: 'failed', type: 'resumable', owner: 'APPLICATION', method: 'm', params: [], startedAt: 1, restarts: 0, failure: { error: 'x', attempts: 1 } }],
            cancel: jest.fn(), discard: jest.fn(),
        });
        const scripts = Object.assign(new (require('events').EventEmitter)(), { list: () => [], cancelRun: jest.fn() });
        const host: any = {
            working_directory: '/x', operations_directory: '/x', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [{ id: 'a', state: 'started', resumableStore: store, scripts }], listPlugins: () => [], getApplication: (id: string) => id === "a" ? { id: "a", state: "started", resumableStore: store, scripts } : undefined,
            withApplicationExclusive: async (_id: string, fn: any) => fn(undefined),
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appResumables', params: { id: 'a' } }));
        ws.send(JSON.stringify({ type: 'call', id: 2, action: 'resumable.discard', params: { app: 'a', key: '4' } }));
        ws.send(JSON.stringify({ type: 'call', id: 3, action: 'resumable.cancel', params: { app: 'a', key: '4' } }));
        ws.send(JSON.stringify({ type: 'call', id: 4, action: 'script.cancel', params: { app: 'a', script: 's', run: '9' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 4) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual(expect.arrayContaining([
            { type: 'snapshot', id: 1, data: { resumables: [expect.objectContaining({ key: '4', owner: 'a', status: 'failed' })], scripts: [] } },
            { type: 'result', id: 2, ok: true },
            { type: 'result', id: 3, ok: true },
            { type: 'result', id: 4, ok: true },
        ]));
        expect(store.discard).toHaveBeenCalledWith(4);
        expect(store.cancel).toHaveBeenCalledWith(4, 'Cancelled from the dashboard');
        expect(scripts.cancelRun).toHaveBeenCalledWith('s', 9, 'Cancelled from the dashboard');
    });

    it('serves the appSchedules topic', async () => {
        unmount();
        const schedules = new ScheduleRegistry();
        schedules.add({ expression: 'sunset-0:30', kind: 'sun', method: 'lights_on' });
        const host: any = {
            working_directory: '/x', operations_directory: '/x', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [{ id: 'a', state: 'started', schedules }], listPlugins: () => [], getApplication: (id: string) => id === "a" ? { id: "a", state: "started", schedules } : undefined,
            withApplicationExclusive: async (_id: string, fn: any) => fn(undefined),
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appSchedules', params: { id: 'a' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 1) { clearInterval(t); r() } }, 5) });
        schedules.add({ expression: "run_in('1s')", kind: 'at', method: 'later' });
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 2) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual([
            { type: 'snapshot', id: 1, data: { rows: [{ key: '1', expression: 'sunset-0:30', kind: 'sun', method: 'lights_on' }] } },
            { type: 'delta', id: 1, data: { upsert: [{ key: '2', expression: "run_in('1s')", kind: 'at', method: 'later' }] } },
        ]);
    });

    it('serves the appHttp topic', async () => {
        unmount();
        const routes = new HttpRouteRegistry();
        routes.add({ appUuid: 'a', kind: 'route', method: 'GET', path: '/scenes', handler: 'list' });
        const host: any = {
            working_directory: '/x', operations_directory: '/x', currentConfig: { apps: { a: { source: 'a.ts' } } },
            listApplications: () => [], listPlugins: () => [{ id: 'http', instance: { routes, port: 9000 } }], getApplication: () => undefined,
            withApplicationExclusive: async (_id: string, fn: any) => fn(undefined),
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appHttp', params: { id: 'a' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 1) { clearInterval(t); r() } }, 5) });
        routes.add({ appUuid: 'a', kind: 'static', path: '/ui', directory: '/x/www' });
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 2) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual([
            { type: 'snapshot', id: 1, data: { port: 9000, rows: [{ key: '1', kind: 'route', method: 'GET', path: '/scenes', handler: 'list', url: '/app/a/scenes' }] } },
            { type: 'delta', id: 1, data: { upsert: [{ key: '2', kind: 'static', path: '/ui', handler: 'www', url: '/app/a/ui' }] } },
        ]);
    });

    it('serves the appConfig topic', async () => {
        unmount();
        const host: any = {
            working_directory: '/x', operations_directory: '/x', currentConfig: { apps: { a: { source: '/x/a.ts', export: null } } },
            configFile: '/nonexistent/config.yaml', rawAppConfig: () => ({ source: 'a.ts' }),
            listApplications: () => [], listPlugins: () => [], getApplication: () => undefined,
            isApplicationStopped: () => false, watchConfigEntry: () => () => { }, on() { }, off() { },
            restartApplication: async () => { }, stopApplication: async () => { }, startApplication: async () => { },
        };
        unmount = mountDashboard(server, express(), host);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const msgs: any[] = [];
        ws.on('message', d => msgs.push(JSON.parse(d.toString())));
        await new Promise<void>(r => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'subscribe', id: 1, topic: 'appConfig', params: { id: 'a' } }));
        await new Promise<void>(r => { const t = setInterval(() => { if (msgs.length >= 1) { clearInterval(t); r() } }, 5) });
        ws.close();
        expect(msgs).toEqual([
            { type: 'snapshot', id: 1, data: { config: { source: '/x/a.ts', export: null }, defaults: [['export']], file: '/nonexistent/config.yaml' } },
        ]);
    });

    it('does not accept websocket upgrades on other paths', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
        const err = await new Promise<any>(resolve => { ws.on('error', resolve); ws.on('open', () => resolve(null)); });
        expect(err).not.toBeNull();
    });
});
