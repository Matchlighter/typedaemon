// @vitest-environment happy-dom
import type { AppDetail, AppRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, system: null as any }));
vi.mock('../app', async () => {
    const { PageChrome } = await import('../stores/page_chrome');
    return { app: { chrome: new PageChrome(), get connection() { return sock.connection }, get system() { return sock.system } } };
});

const row = (state: AppRow['state'] = 'started', over: Partial<AppRow> = {}): AppRow =>
    ({ id: 'lights', name: 'Lights', source: 'apps/lights/index.ts', kind: 'thick', state, since: Date.now() - 540_000, ...over });
const detail = (over: Partial<AppDetail> & { row?: AppRow } = {}): AppDetail => ({
    row: row(), uuid: 'u-123', instanceOf: 'apps/lights/index.ts#Lights', logLevel: 'debug', packages: { dayjs: '^1.11' },
    watching: true, counts: {}, ...over,
});

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const text = () => host.textContent!;
const sent = () => sock.current.sent as any[];
const snapshot = (d: AppDetail) => serverSend({ type: 'snapshot', id: 1, data: d });
const delta = (d: AppDetail) => serverSend({ type: 'delta', id: 1, data: d });
const button = (label: RegExp) => [...host.querySelectorAll('button')].find(b => label.test(b.textContent!)) as HTMLButtonElement;

async function mount(props: { id?: string; tab?: string } = {}) {
    const { AppDetailView } = await import('./AppDetail');
    await act(async () => { root.render(<AppDetailView id={props.id ?? 'lights'} tab={props.tab} />) });
    // The app-wide system handle (permanent in the real app); activated after the view so the app topic keeps subscription id 1
    const { TopicStore } = await import('../stores/topic_store');
    sock.system = new TopicStore(sock.connection, 'system');
    sock.system.activate();
    act(() => sock.current.onopen());
}

beforeEach(async () => {
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('App detail: data', () => {
    it('subscribes to the app topic for its id and shows syncing first', async () => {
        await mount({ id: 'my app' });
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'app', params: { id: 'my app' } });
        expect(text()).toContain('Syncing');
    });

    it('shows the server error (e.g. unknown app) with a way back', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' });
        expect(text()).toContain("Couldn't load app");
        expect(text()).toContain('Unknown app: lights');
        expect(host.querySelector('a[href="#/apps"]')).not.toBeNull();
    });
});

describe('App detail: header', () => {
    it('shows name, state, id, kind, export and source', async () => {
        await mount();
        await snapshot(detail());
        const h = host.querySelector('header.appd-head')!;
        expect(h.textContent).toContain('Lights');
        expect(h.textContent).toContain('started');
        expect(h.textContent).toContain('up');
        expect(h.textContent).toContain('lights');
        expect(h.textContent).toContain('thick');
        expect(h.textContent).toContain('export Lights');
        expect(h.textContent).toContain('apps/lights/index.ts');
    });

    it('follows live state, including the hot-reload sequence', async () => {
        await mount();
        await snapshot(detail());
        for (const state of ['stopping', 'compiling', 'starting', 'started'] as const) {
            await delta(detail({ row: row(state) }));
            expect(host.querySelector('header.appd-head .badge')!.textContent).toBe(state);
        }
    });

    it('offers Restart and Stop for a running app and sends the action', async () => {
        await mount();
        await snapshot(detail());
        expect(button(/^Start$/)).toBeUndefined();
        await act(async () => { button(/Restart/).click() });
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'app.restart', params: { id: 'lights' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        await act(async () => { button(/Stop/).click() });
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'app.stop', params: { id: 'lights' } });
    });

    it('disables the actions while a call is in flight and re-enables on result', async () => {
        await mount();
        await snapshot(detail());
        await act(async () => { button(/Restart/).click() });
        expect(button(/Restart/).disabled).toBe(true);
        expect(button(/Stop/).disabled).toBe(true);
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        expect(button(/Restart/).disabled).toBe(false);
    });

    it('shows restarting (no stopped badge, no Start) while a dashboard restart is in flight, then the real state', async () => {
        await mount();
        await snapshot(detail());
        await act(async () => { button(/Restart/).click() });
        const badge = () => host.querySelector('header.appd-head .badge')!.textContent;
        for (const state of ['stopping', 'stopped', 'initializing', 'compiling', 'starting'] as const) {
            await delta(detail({ row: row(state) }));
            expect(badge()).toBe('restarting');
            expect(button(/^Start$/)).toBeUndefined();
        }
        await delta(detail({ row: row('started') }));
        expect(badge()).toBe('started');
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        await delta(detail({ row: row('stopped') }));
        expect(badge()).toBe('stopped');
        expect(button(/^Start$/)).toBeDefined();
    });

    it('shows a failed action', async () => {
        await mount();
        await snapshot(detail());
        await act(async () => { button(/Stop/).click() });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: false, message: 'cannot stop' });
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('cannot stop');
    });

    it('offers only Start for a stopped app', async () => {
        await mount();
        await snapshot(detail({ row: row('stopped') }));
        expect(button(/Start/)).toBeDefined();
        expect(button(/Restart/)).toBeUndefined();
        expect(button(/Stop/)).toBeUndefined();
        expect(text()).not.toContain('override');
    });

    it('explains the stop override', async () => {
        await mount();
        await snapshot(detail({ row: row('stopped', { stoppedOverride: true }) }));
        expect(host.querySelector('header .badge')!.textContent).toBe('stopped · override');
        const notice = host.querySelector('[role="status"].appd-override')!;
        expect(notice.textContent).toContain('resets on next config reload');
    });
});

describe('App detail: tabs', () => {
    it('lists the tabs with counts, linking under the app route', async () => {
        await mount();
        await snapshot(detail({ counts: { entities: 14, unlinkedEntities: 1, storage: 5, schedules: 6 } }));
        const tabs = [...host.querySelectorAll('nav.appd-tabs a')] as HTMLAnchorElement[];
        expect(tabs.map(a => a.dataset.tab)).toEqual(['overview', 'logs', 'entities', 'storage', 'resumables', 'schedules', 'http', 'config']);
        const byTab = (k: string) => tabs.find(a => a.dataset.tab === k)!;
        expect(byTab('entities').textContent).toContain('14');
        expect(byTab('entities').textContent).toContain('+1 unlinked');
        expect(byTab('storage').textContent).toContain('5');
        expect(byTab('logs').textContent).toBe('Logs');
        expect(byTab('logs').getAttribute('href')).toBe('#/apps/lights/logs');
        expect(byTab('overview').getAttribute('href')).toBe('#/apps/lights');
    });

    it('the entities tab subscribes to that app\'s entities and survives app restarts', async () => {
        await mount({ tab: 'entities' });
        await snapshot(detail());
        const sub = sent().find(m => m.type === 'subscribe' && m.topic === 'appEntities');
        expect(sub).toMatchObject({ params: { id: 'lights' } });
        const subs = () => sent().filter(m => m.type === 'subscribe').length;
        const before = subs();
        for (const state of ['stopping', 'compiling', 'starting', 'started'] as const) await delta(detail({ row: row(state) }));
        expect(subs()).toBe(before);
        expect(host.querySelector('[data-tabpanel="entities"] .ents')).not.toBeNull();
    });

    it('marks the selected tab and renders its content', async () => {
        await mount({ tab: 'storage' });
        await snapshot(detail());
        const current = host.querySelectorAll('nav.appd-tabs a[aria-current="page"]');
        expect(current).toHaveLength(1);
        expect((current[0] as HTMLElement).dataset.tab).toBe('storage');
        expect(host.querySelector('[data-tabpanel="storage"]')).not.toBeNull();
    });

    it('keeps the tab and its DOM across a restart', async () => {
        await mount({ tab: 'storage' });
        await snapshot(detail());
        const panel = host.querySelector('[data-tabpanel="storage"]');
        for (const state of ['stopping', 'compiling', 'started'] as const) await delta(detail({ row: row(state) }));
        expect(host.querySelector('[data-tabpanel="storage"]')).toBe(panel);
    });
});

describe('App detail: overview tab', () => {
    it('shows summary cards, using a dash where a subsystem reports nothing', async () => {
        await mount();
        await snapshot(detail({ counts: { entities: 14, unlinkedEntities: 1, schedules: 6 } }));
        const card = (k: string) => host.querySelector(`[data-card="${k}"]`)!.textContent!;
        expect(card('entities')).toContain('14');
        expect(card('entities')).toContain('1 unlinked');
        expect(card('schedules')).toContain('6');
        expect(card('storage')).toContain('—');
        expect(card('scripts')).toContain('—');
    });

    it('shows what each card says beneath its number', async () => {
        await mount();
        await snapshot(detail({
            counts: { entities: 14, schedules: 6, storage: 5, scripts: 1 },
            summary: {
                nextSchedule: { expression: "run_every('5m')", at: Date.now() + 166_000 },
                storage: { bytes: 2457, internal: 3, lastWriteAt: Date.now() - 540_000 },
                scripts: { running: ['scene_transition'], queued: 0 },
            },
        }));
        const card = (k: string) => host.querySelector(`[data-card="${k}"]`)!.textContent!;
        expect(card('schedules')).toContain("next run_every('5m')");
        expect(card('storage')).toContain('keys · 2.4 KB');
        expect(card('storage')).toContain('+3 internal · last write');
        expect(card('scripts')).toContain('1 running');
        expect(card('scripts')).toContain('scene_transition · 0 queued');
    });

    it('shows the plugins the app depends on as chips', async () => {
        await mount();
        await snapshot(detail({ summary: { dependsOn: ['ha', 'mqtt'] } }));
        const chips = [...host.querySelectorAll('[data-card="details"] .appd-deps .chip')].map(e => e.textContent);
        expect(chips).toEqual(['ha', 'mqtt']);
    });

    it('shows details: uuid, instance of, log level, packages', async () => {
        await mount();
        await snapshot(detail());
        const d = host.querySelector('[data-card="details"]')!.textContent!;
        expect(d).toContain('u-123');
        expect(d).toContain('apps/lights/index.ts#Lights');
        expect(d).toContain('debug');
        expect(d).toContain('dayjs');
        expect(d).toContain('^1.11');
    });

    it('has a recent logs card that links to the logs tab', async () => {
        await mount();
        await snapshot(detail());
        expect(host.querySelector('[data-card="logs"] a[href="#/apps/lights/logs"]')).not.toBeNull();
    });

    describe('recent logs', () => {
        const logRow = (id: number, over: object = {}) => ({ id, ts: id, level: 'info', source: { kind: 'app', id: 'lights' }, channel: 'user', message: `line ${id}`, ...over });
        const logsSub = () => sent().find(m => m.type === 'subscribe' && m.topic === 'logs');
        const logsSnapshot = (entries: object[]) => serverSend({ type: 'snapshot', id: logsSub().id, data: { entries } });
        const logsDelta = (append: object[]) => serverSend({ type: 'delta', id: logsSub().id, data: { append } });
        const shown = () => [...host.querySelectorAll('[data-card="logs"] .log-msg')].map(e => e.textContent);

        it('subscribes to only this app\'s newest few lines', async () => {
            await mount();
            await snapshot(detail());
            expect(logsSub().params).toEqual({ sources: [{ kind: 'app', id: 'lights' }], limit: 100 });
        });

        it('shows them, and keeps showing only the newest few as more arrive', async () => {
            await mount();
            await snapshot(detail());
            await logsSnapshot([1, 2, 3, 4, 5].map(i => logRow(i)));
            expect(shown()).toHaveLength(5);
            await logsDelta([logRow(6), logRow(7)]);
            expect(shown()).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7']);
        });

        it('leaves out debug lines and the source column', async () => {
            await mount();
            await snapshot(detail());
            await logsSnapshot([logRow(1), logRow(2, { level: 'debug' }), logRow(3, { level: 'warn' })]);
            expect(shown()).toEqual(['line 1', 'line 3']);
            expect(host.querySelector('[data-card="logs"] .log-src')).toBeNull();
        });

        it('keeps the last lines, marked stale, while the connection is down', async () => {
            await mount();
            await snapshot(detail());
            await logsSnapshot([1, 2].map(i => logRow(i)));
            await act(async () => { sock.current.onclose() });
            expect(shown()).toEqual(['line 1', 'line 2']);
            expect(host.querySelector('[data-card="logs"] .liststate-stale')).not.toBeNull();
            expect(host.querySelector('[data-card="logs"]')!.textContent).not.toContain('Syncing');
        });

        it('says so when nothing has been logged', async () => {
            await mount();
            await snapshot(detail());
            await logsSnapshot([]);
            expect(host.querySelector('[data-card="logs"]')!.textContent).toContain('No log lines yet');
        });
    });
});

describe('App detail: dead plugins card', () => {
    const deadDetail = () => detail({ row: row('dead', { error: { message: 'boom', phase: 'starting' } }), failure: { message: 'boom', phase: 'starting', frames: [] } });

    it('shows the live connection state of the plugins next to the failure', async () => {
        await mount();
        await snapshot(deadDetail());
        const sub = sent().find(m => m.topic === 'plugins');
        expect(sub).toBeTruthy();
        await serverSend({ type: 'snapshot', id: sub.id, data: { plugins: [{ id: 'ha', type: 'home_assistant', state: 'started', since: 1, connection: 'disconnected', config: {} }] } });
        const card = host.querySelector('.errpanel-plugins')!;
        expect(card.textContent).toContain('ha');
        expect(card.textContent).toContain('disconnected');
    });

    it('does not subscribe to plugins while the app is healthy', async () => {
        await mount();
        await snapshot(detail());
        expect(sent().some(m => m.topic === 'plugins')).toBe(false);
    });
});

describe('App detail: dead blocked calls card', () => {
    const deadDetail = () => detail({ row: row('dead', { error: { message: 'boom', phase: 'starting' } }), failure: { message: 'boom', phase: 'starting', frames: [] } });
    const callRow = (uuid: string, over: object = {}) => ({ uuid, source: 'door', target: 'lights', method: 'open', status: 'pending', targetState: 'dead', ...over });

    it('shows the pending cross-app calls waiting on this app', async () => {
        await mount();
        await snapshot(deadDetail());
        const sub = sent().find(m => m.topic === 'system');
        expect(sub).toBeTruthy();
        await serverSend({ type: 'snapshot', id: sub.id, data: { version: 'v', startedAt: 0, now: 0, state: 'running', crossCalls: [callRow('1'), callRow('2', { target: 'other' }), callRow('3', { status: 'started' })] } });
        const card = host.querySelector('.errpanel-blocked')!;
        expect(card.textContent).toContain('door');
        expect(card.textContent).toContain('open');
        expect(card.querySelectorAll('li')).toHaveLength(1);
    });

    it('reuses the shared system subscription instead of making its own', async () => {
        await mount();
        await snapshot(deadDetail());
        expect(sent().filter(m => m.type === 'subscribe' && m.topic === 'system')).toHaveLength(1);
    });
});

describe('App detail: dead', () => {
    const dead = () => detail({
        row: row('dead', { error: { message: 'boom', phase: 'starting' } }),
        failure: { message: 'boom', phase: 'starting', frames: [{ fn: 'Lights.init', file: 'apps/lights/index.ts', line: 4, col: 5 }] },
    });

    it('shows the startup error panel with the mapped stack, above the tab content', async () => {
        await mount();
        await snapshot(dead());
        const panel = host.querySelector('[data-error-panel]')!;
        expect(panel.textContent).toContain('Failed during starting');
        expect(panel.textContent).toContain('boom');
        expect(panel.textContent).toContain('Lights.init');
        expect(panel.textContent).toContain('apps/lights/index.ts:4:5');
        expect(panel.compareDocumentPosition(host.querySelector('[data-tabpanel]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows the code frame in the panel and an Open logs action beside Restart now (phone bar)', async () => {
        await mount();
        const d = dead();
        d.failure!.codeFrame = { file: 'apps/lights/index.ts', line: 4, col: 5, lines: [{ n: 3, text: 'a' }, { n: 4, text: 'b' }] };
        await snapshot(d);
        expect(host.querySelector('[data-error-panel] .ln.hit .n')!.textContent).toBe('4');
        expect(host.querySelector('.appd-actions a[href="#/apps/lights/logs?focus=error"]')!.textContent).toBe('Open logs');
        expect(host.querySelector('[data-error-panel] a[href="#/apps/lights/logs?focus=error"]')).not.toBeNull();
    });

    it('links Open logs and the panel to the log line that reported the failure', async () => {
        await mount();
        const d = dead();
        d.failure!.logId = 77;
        await snapshot(d);
        expect(host.querySelector('.appd-actions a[href="#/apps/lights/logs?focus=77"]')).not.toBeNull();
        expect(host.querySelector('[data-error-panel] a[href="#/apps/lights/logs?focus=77"]')).not.toBeNull();
    });

    it('says it restarts on next save when watching, with a primary Restart now', async () => {
        await mount();
        await snapshot(dead());
        expect(host.querySelector('header')!.textContent).toMatch(/died .*Watching — restarts on next save/);
        expect(button(/Restart now/).classList.contains('btn-primary')).toBe(true);
    });

    it('right-aligns a primary Restart with a plain Stop; phone hides Stop only while dead', async () => {
        await mount();
        await snapshot(detail());
        expect(button(/Restart/).classList.contains('btn-primary')).toBe(true);
        expect(button(/Stop/).className).toBe('btn');
        await delta(dead());
        expect(button(/Stop/).classList.contains('appd-phone-hide')).toBe(true);
    });

    it('names itself in the phone top bar with a back link', async () => {
        const { app } = await import('../app');
        await mount();
        await snapshot(detail());
        expect(app.chrome.current).toMatchObject({ title: 'Lights', backHref: '#/apps' });
        await act(async () => { root.unmount() });
        expect(app.chrome.current).toBeUndefined();
        root = createRoot(host);
    });

    it('does not promise a restart when not watching', async () => {
        await mount();
        await snapshot({ ...dead(), watching: false });
        expect(host.querySelector('header')!.textContent).not.toContain('restarts on next save');
    });

    it('clears the panel when the app recovers', async () => {
        await mount();
        await snapshot(dead());
        await delta(detail());
        expect(host.querySelector('[data-error-panel]')).toBeNull();
    });
});
