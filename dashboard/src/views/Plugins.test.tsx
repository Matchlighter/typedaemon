// @vitest-environment happy-dom
import type { PluginRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

const row = (id: string, over: Partial<PluginRow> = {}): PluginRow =>
    ({ id, type: 'mqtt', state: 'started', since: Date.now() - 60_000, config: {}, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const text = () => host.textContent!;
const rowFor = (id: string) => host.querySelector(`[data-plugin="${id}"]`) as HTMLElement;
const snapshot = (plugins: PluginRow[]) => serverSend({ type: 'snapshot', id: 1, data: { plugins } });
/** Poll until `cond` holds (e.g. the lazy detail chunk has rendered) */
const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) });
    if (!cond()) throw new Error('waitFor timed out');
};
const detailLoaded = () => host.querySelector('.plugin-detail') !== null;
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });

async function mount(node: (m: any) => React.ReactNode) {
    const m = await import('./Plugins');
    await act(async () => { root.render(node(m)) });
    act(() => sock.current.onopen());
}

// The log list is virtualized: give it a viewport
beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(25);
});

beforeEach(async () => {
    await import('./PluginDetailPanel'); // so the lazy chunk resolves promptly
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove() });

describe('Plugins list', () => {
    const mountList = () => mount(m => <m.Plugins />);

    it('subscribes to the plugins topic and shows syncing first', async () => {
        await mountList();
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'plugins' });
        expect(text()).toContain('Syncing');
    });

    it('lists id, type, connection state, target, since and log level, linking to the detail page', async () => {
        await mountList();
        await snapshot([row('ha', { type: 'home_assistant', connection: 'connected', target: 'http://ha:8123', logLevel: 'debug' })]);
        const r = rowFor('ha');
        expect(r.textContent).toContain('ha');
        expect(r.textContent).toContain('home_assistant');
        expect(r.textContent).toContain('connected');
        expect(r.textContent).toContain('http://ha:8123');
        expect(r.textContent).toContain('debug');
        expect(r.querySelector('a')!.getAttribute('href')).toBe('#/plugins/ha');
    });

    it('shows the plugin status line and links the apps using it', async () => {
        await mountList();
        await snapshot([row('http', { summary: [{ label: 'Routes', value: '2 routes' }, { label: 'Discovery', value: 'prefix homeassistant/' }], usedBy: ['lights', 'hvac'] }), row('mqtt')]);
        expect(rowFor('http').textContent).toContain('Routes2 routes');
        const links = [...rowFor('http').querySelectorAll('a')].map(a => a.getAttribute('href'));
        expect(links).toEqual(['#/plugins/http', '#/apps/lights', '#/apps/hvac']);
        expect(rowFor('mqtt').textContent).toContain('Used by—');
    });

    it('reflects a disconnect and reconnect live', async () => {
        await mountList();
        await snapshot([row('mqtt', { connection: 'connected' })]);
        expect(rowFor('mqtt').textContent).toContain('connected');
        await delta({ upsert: [row('mqtt', { connection: 'reconnecting' })] });
        expect(rowFor('mqtt').textContent).toContain('reconnecting');
        expect(rowFor('mqtt').classList.contains('flash')).toBe(true);
        await delta({ upsert: [row('mqtt', { connection: 'connected' })] });
        expect(rowFor('mqtt').textContent).toContain('connected');
        expect(rowFor('mqtt').textContent).not.toContain('reconnecting');
    });

    it('shows lifecycle state for a plugin that is not running', async () => {
        await mountList();
        await snapshot([row('mqtt', { state: 'stopped' })]);
        expect(rowFor('mqtt').textContent).toContain('stopped');
    });

    it('explains an empty config', async () => {
        await mountList();
        await snapshot([]);
        expect(text()).toContain('No plugins configured');
    });

    it('dims the list when the connection is stale', async () => {
        await mountList();
        await snapshot([row('a')]);
        await act(async () => { sock.current.onclose() });
        expect(host.querySelector('.liststate-stale')).toBeTruthy();
    });

    it('shows the server error', async () => {
        await mountList();
        await serverSend({ type: 'error', id: 1, message: 'boom' });
        expect(text()).toContain('boom');
    });
});

describe('Plugin detail: logs', () => {
    it("shows the plugin's own log lines, subscribing to that plugin only", async () => {
        await mount(m => <m.Plugins selected="ha" />);
        await snapshot([row('ha')]);
        await waitFor(detailLoaded);
        const sub = sock.current.sent.find((m: any) => m.topic === 'logs');
        expect(sub).toMatchObject({ params: { sources: [{ kind: 'plugin', id: 'ha' }] } });
        await serverSend({ type: 'snapshot', id: sub.id, data: { entries: [{ id: 1, ts: 1, level: 'info', source: { kind: 'plugin', id: 'ha' }, channel: 'manager', message: 'connected to HA' }] } });
        expect(host.querySelector('[aria-label="Logs"]')!.textContent).toContain('connected to HA');
    });
});

describe('Plugin detail', () => {
    const mountDetail = (id = 'ha') => mount(m => <m.Plugins selected={id} />);
    const snap = async (rows: PluginRow[]) => { await snapshot(rows); await waitFor(detailLoaded) };

    it('shows status, target, log level and the config', async () => {
        await mountDetail();
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'plugins' });
        await snap([row('ha', { type: 'home_assistant', connection: 'connected', target: 'http://ha:8123', logLevel: 'debug', config: { type: 'home_assistant', url: 'http://ha:8123', access_token: '***' } })]);
        expect(text()).toContain('connected');
        expect(text()).toContain('home_assistant');
        expect(text()).toContain('http://ha:8123');
        expect(text()).toContain('debug');
        expect(text()).toContain('access_token');
        expect(rowFor('ha').classList.contains('selected')).toBe(true);
        expect(host.querySelector('[aria-label="ha detail"]')).not.toBeNull();
    });

    it('Reconnect calls the plugin.reconnect action and shows a rejection', async () => {
        await mountDetail();
        await snap([row('ha', { type: 'home_assistant' })]);
        const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Reconnect')!;
        await act(async () => { btn.click() });
        const call = sock.current.sent.find((m: any) => m.type === 'call');
        expect(call).toMatchObject({ action: 'plugin.reconnect', params: { id: 'ha' } });
        await serverSend({ type: 'result', id: call.id, ok: false, message: 'cannot reconnect' });
        expect(text()).toContain('cannot reconnect');
    });

    it('disables Reconnect when the plugin is not running', async () => {
        await mountDetail();
        await snap([row('ha', { state: 'stopped' })]);
        expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Reconnect')!.disabled).toBe(true);
    });

    it('updates live', async () => {
        await mountDetail();
        await snap([row('ha', { connection: 'connected' })]);
        await delta({ upsert: [row('ha', { connection: 'disconnected' })] });
        // The detail chunk may still be settling (Suspense retry) when the delta lands: wait for the card to follow
        await waitFor(() => host.querySelector('.plugin-card .badge')?.textContent === 'disconnected');
    });

    it('says when the plugin is not configured', async () => {
        await mountDetail('nope');
        await snapshot([row('ha')]);
        expect(text()).toContain('No such plugin');
        expect(rowFor('ha')).not.toBeNull();
    });
});
