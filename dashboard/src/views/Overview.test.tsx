// @vitest-environment happy-dom
import type { AppRow, LifecycleEvent, PluginRow, ServerMessage, TopicName } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, system: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, get system() { return sock.system } } }));

const row = (id: string, state: AppRow['state'] = 'started', over: Partial<AppRow> = {}): AppRow =>
    ({ id, name: id, source: `apps/${id}.ts`, state, since: Date.now() - 60_000, ...over });
const plug = (id: string, over: Partial<PluginRow> = {}): PluginRow =>
    ({ id, type: 'mqtt', state: 'started', since: 0, connection: 'connected', config: {}, ...over });
const ev = (id: number, over: Partial<LifecycleEvent> = {}): LifecycleEvent =>
    ({ id, ts: Date.now() - 120_000, app: 'a', name: 'a', state: 'started', ...over });

let host: HTMLElement, root: Root;
const text = () => host.textContent!;
const subId = (topic: TopicName): number => sock.current.sent.find((m: any) => m.type === 'subscribe' && m.topic === topic).id;
const snapshot = (topic: TopicName, data: unknown) =>
    act(() => { sock.current.onmessage({ data: JSON.stringify({ type: 'snapshot', id: subId(topic), data } satisfies ServerMessage) }) });
const delta = (topic: TopicName, data: unknown) =>
    act(() => { sock.current.onmessage({ data: JSON.stringify({ type: 'delta', id: subId(topic), data } satisfies ServerMessage) }) });
const card = (name: string) => host.querySelector(`[data-card="${name}"]`) as HTMLElement;

async function mount() {
    const { Overview } = await import('./Overview');
    await act(async () => { root.render(<Overview />) });
    act(() => sock.current.onopen());
}

function loadAll(over: { apps?: AppRow[]; orphans?: string[]; plugins?: PluginRow[]; events?: LifecycleEvent[]; calls?: any[]; entities?: any[]; schedules?: any[]; resumables?: any[] } = {}) {
    snapshot('system', { version: '1.2.3', startedAt: Date.now() - 3 * 3600_000, now: Date.now(), state: 'running', configPath: '/config/td.yaml', location: { timezone: 'America/Denver' }, crossCalls: over.calls ?? [] });
    snapshot('apps', { apps: over.apps ?? [row('a')], orphans: (over.orphans ?? []).map(id => ({ id })) });
    snapshot('plugins', { plugins: over.plugins ?? [plug('mqtt')], append: [] });
    snapshot('lifecycle', { events: over.events ?? [] });
    snapshot('entities', { rows: over.entities ?? [] });
    snapshot('schedules', { rows: over.schedules ?? [] });
    snapshot('resumables', { rows: over.resumables ?? [] });
}

beforeEach(async () => {
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    const { TopicStore } = await import('../stores/topic_store');
    sock.system = new TopicStore(sock.connection, 'system');
    sock.system.activate();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Overview view', () => {
    it('shows syncing until data arrives', async () => {
        await mount();
        expect(text()).toContain('Syncing');
    });

    it('subscribes to every topic it needs', async () => {
        await mount();
        const topics = sock.current.sent.filter((m: any) => m.type === 'subscribe').map((m: any) => m.topic).sort();
        expect(topics).toEqual(['apps', 'entities', 'lifecycle', 'plugins', 'resumables', 'schedules', 'system']);
    });

    it('answers "is everything OK" with five summary cards', async () => {
        await mount();
        loadAll({
            apps: [row('a'), row('b', 'compiling'), row('c', 'dead'), row('d', 'started', { resumables: 3, failedResumes: 1 })],
            orphans: ['x'], plugins: [plug('p1'), plug('p2', { connection: 'disconnected' })],
            entities: [{ key: '1', app: 'a', linked: true }, { key: '2', app: 'x', linked: false, orphan: true }, { key: '3', app: 'x', linked: false, orphan: true }],
        });
        expect(card('apps').textContent).toContain('4');
        expect(card('apps').textContent).toContain('2 started · 1 starting · 1 dead');
        expect(card('apps').querySelectorAll('.pbar > span')).toHaveLength(3);
        expect(card('plugins').textContent).toContain('1/2');
        expect(card('plugins').textContent).toContain('1 not connected');
        expect(card('orphans').textContent).toContain('x · 2 entities left in HA');
        expect(card('orphans').className).toContain('ov-warn');
        expect(card('resumables').textContent).toContain('2 waiting · 1 failed to resume');
        expect(card('entities').textContent).toContain('1 linked · 2 unlinked');
    });

    it('shows the status strip', async () => {
        await mount();
        loadAll();
        const strip = host.querySelector('.ov-status')!.textContent!;
        expect(strip).toContain('running');
        expect(strip).toContain('Hypervisor up 3h 0m');
        expect(strip).toContain('America/Denver');
        expect(strip).toContain('/config/td.yaml');
    });

    it('says all is well when nothing needs attention', async () => {
        await mount();
        loadAll();
        expect(text()).toContain('Everything is running');
        expect(host.querySelector('[data-attention]')).toBeNull();
    });

    it('lists attention items, each linking to its fix', async () => {
        await mount();
        loadAll({
            apps: [row('lights', 'dead', { error: { message: 'boom', phase: 'compiling' } }), row('b', 'started', { failedResumes: 1 })],
            plugins: [plug('mqtt', { connection: 'disconnected' })],
            orphans: ['old'],
        });
        const rows = [...host.querySelectorAll('[data-attention]')].map(r => [r.querySelector('.badge')!.textContent, r.querySelector('a')!.textContent, r.querySelector('a.btn')!.textContent, r.querySelector('a.btn')!.getAttribute('href')]);
        expect(rows).toEqual([
            ['dead', 'lights', 'View error', '#/apps/lights'],
            ['disconnected', 'mqtt', 'View plugin', '#/plugins/mqtt'],
            ['failed to resume', 'b', 'View resumables', '#/apps/b/resumables'],
            ['orphan', 'old', 'Review & clean up', '#/apps/old'],
        ]);
        expect(text()).toContain('failed while compiling');
        expect(host.querySelector('.ov-detail-error')!.textContent).toBe('boom');
    });

    it('cards link to the relevant view', async () => {
        await mount();
        loadAll();
        expect(card('plugins').closest('a')?.getAttribute('href')).toBe('#/plugins');
        expect(card('apps').closest('a')?.getAttribute('href')).toBe('#/apps');
    });

    it('updates counts and attention live', async () => {
        await mount();
        loadAll({ apps: [row('a')] });
        expect(host.querySelector('[data-attention]')).toBeNull();
        delta('apps', { upsert: [row('a', 'dead', { error: { message: 'bad', phase: 'starting' } })] });
        expect(card('apps').textContent).toContain('1 dead');
        expect(host.querySelector('[data-attention="app:a"]')!.textContent).toContain('failed while starting');
    });

    it('shows the lifecycle feed newest first, with the restart cause', async () => {
        await mount();
        loadAll({ events: [ev(1, { name: 'old', cause: 'manual' }), ev(2, { name: 'lights', cause: 'source_change' })] });
        const rows = [...host.querySelectorAll('[data-event]')].map(r => r.textContent!);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('lights');
        expect(rows[0]).toContain('Restarted after source change');
        expect(rows[1]).toContain('Restarted from the dashboard');
        delta('lifecycle', { append: [ev(3, { name: 'new', state: 'dead', error: 'kaboom' })] });
        const first = host.querySelector('[data-event]')!;
        expect(first.textContent).toContain('new');
        expect(first.textContent).toContain('kaboom');
    });

    it('a death links its error to the log line that reported it; without one the error is plain text', async () => {
        await mount();
        loadAll({ events: [ev(1, { app: 'lights', state: 'dead', error: 'boom', errorLogId: 42 }), ev(2, { app: 'door', state: 'dead', error: 'bang' })] });
        const link = host.querySelector('[data-event="1"] a.ov-event-error')!;
        expect(link.getAttribute('href')).toBe('#/apps/lights/logs?focus=42');
        expect(link.textContent).toBe('boom');
        expect(host.querySelector('[data-event="2"] a.ov-event-error')).toBeNull();
        expect(host.querySelector('[data-event="2"] .ov-event-error')!.textContent).toBe('bang');
    });

    it('feed links each event to its app', async () => {
        await mount();
        loadAll({ events: [ev(1, { app: 'lights', name: 'Lights' })] });
        expect(host.querySelector('[data-event] a')?.getAttribute('href')).toBe('#/apps/lights');
    });

    it('feed shows each app\'s from → to transition and an All logs link', async () => {
        await mount();
        loadAll({ events: [ev(1, { app: 'n', name: 'notifier', state: 'started' }), ev(2, { app: 'n', name: 'notifier', state: 'dead', error: 'boom', from: 'started' })] });
        expect(host.querySelector('[data-event="2"]')!.textContent).toContain('started → dead');
        expect(host.querySelector('[data-event="1"]')!.textContent).not.toContain('→');
        expect(host.querySelector('[data-panel="feed"] a.ov-panel-link')!.getAttribute('href')).toBe('#/logs');
    });

    it('lists plugins with their target', async () => {
        await mount();
        loadAll({ plugins: [plug('mqtt', { target: 'mqtt://broker:1883' }), plug('http', { type: 'http', connection: 'listening', target: ':9000' })] });
        const rows = [...host.querySelectorAll('[data-panel="plugins"] [data-plugin]')];
        expect(rows.map(r => r.getAttribute('data-plugin'))).toEqual(['http', 'mqtt']);
        expect(rows[1].textContent).toContain('mqtt://broker:1883');
        expect(rows[1].querySelector('a')!.getAttribute('href')).toBe('#/plugins/mqtt');
    });

    it('Up next shows the next four schedule fires across apps, soonest first', async () => {
        await mount();
        const s = (app: string, n: number, nextAt?: number) => ({ key: `${app}/${n}`, app, expression: `expr${n}`, kind: 'cron', method: `m${n}`, ...(nextAt && { nextAt }) });
        const now = Date.now();
        loadAll({ schedules: [s('a', 1, now + 9e5), s('b', 2, now + 6e4), s('a', 3), s('a', 4, now + 3e5), s('b', 5, now + 1e6), s('b', 6, now + 7e5)] });
        const rows = [...host.querySelectorAll('[data-panel="next"] [data-schedule]')];
        expect(rows.map(r => r.getAttribute('data-schedule'))).toEqual(['b/2', 'a/4', 'b/6', 'a/1']);
        expect(rows[0].textContent).toContain('expr2');
        expect(rows[0].textContent).toContain('b · m2');
        delta('schedules', { upsert: [s('a', 7, now + 1000)] });
        expect(host.querySelector('[data-panel="next"] [data-schedule]')!.getAttribute('data-schedule')).toBe('a/7');
    });

    it('Up next says so when nothing is scheduled', async () => {
        await mount();
        loadAll();
        expect(host.querySelector('[data-panel="next"]')!.textContent).toContain('Nothing scheduled');
    });

    it('phone: compact Apps list links each app with its age', async () => {
        await mount();
        loadAll({ apps: [row('lights', 'started', { name: 'Lights', since: Date.now() - 9 * 60_000 }), row('garage', 'compiling', { since: Date.now() })] });
        const rows = [...host.querySelectorAll('[data-panel="phone-apps"] [data-app]')];
        expect(rows.map(r => r.getAttribute('href'))).toEqual(['#/apps/lights', '#/apps/garage']);
        expect(rows[0].textContent).toContain('started');
        expect(rows[0].textContent).toContain('Lights');
        expect(rows[0].textContent).toContain('9 min');
        expect(rows[1].textContent).toContain('just now');
    });

    it('phone: attention rows end in a chevron', async () => {
        await mount();
        loadAll({ apps: [row('lights', 'dead')] });
        expect(host.querySelector('[data-attention] .ov-chevron')).not.toBeNull();
    });

    it('phone: lists running resumables and cancels one after confirming', async () => {
        await mount();
        const r = (key: string, status: string, over = {}) => ({ key: `a/${key}`, resumableKey: key, app: 'a', owner: 'a', method: key, params: [], type: 'resumable', status, startedAt: Date.now() - 3600_000, restarts: 0, ...over });
        loadAll({ resumables: [r('preheat', 'running', { wait: { kind: 'condition', condition: 'temp > 20', since: 0 } }), r('old', 'failed')] });
        const rows = [...host.querySelectorAll('[data-panel="phone-resumables"] [data-resumable]')];
        expect(rows).toHaveLength(1);
        expect(host.querySelector('[data-panel="phone-resumables"]')!.textContent).toContain('Running resumables · 1');
        expect(rows[0].textContent).toContain('a:preheat');
        expect(rows[0].textContent).toContain('waiting for temp > 20');
        await act(async () => { (rows[0].querySelector('button') as HTMLButtonElement).click() });
        expect(host.querySelector('dialog')!.textContent).toContain('Cancel a:preheat?');
        const before = sock.current.sent.length;
        const confirm = [...host.querySelectorAll('dialog button')].find(b => b.textContent === 'Cancel resumable') as HTMLButtonElement;
        await act(async () => { confirm.click() });
        expect(sock.current.sent.slice(before).find((m: any) => m.type === 'call')).toMatchObject({ action: 'resumable.cancel', params: { app: 'a', key: 'preheat' } });
    });

    it('phone: no resumables card when none are running', async () => {
        await mount();
        loadAll();
        expect(host.querySelector('[data-panel="phone-resumables"]')).toBeNull();
    });
});
