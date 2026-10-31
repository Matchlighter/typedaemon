// @vitest-environment happy-dom
import type { AppConfigSnapshot, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, copy: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));
vi.mock('../components/clipboard', () => ({ copyText: (t: string) => sock.copy(t) }));

const snap = (over: Partial<AppConfigSnapshot> = {}): AppConfigSnapshot => ({
    config: { source: '/w/lights.ts', export: null, logging: { level: 'info' } },
    defaults: [['export'], ['logging', 'level']],
    file: '/config/typedaemon/config.yaml', line: 31, ...over,
});

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const snapshot = (s: AppConfigSnapshot) => serverSend({ type: 'snapshot', id: 1, data: s });
const text = () => host.textContent ?? '';

async function mount() {
    const { AppConfigTab } = await import('./AppConfigTab');
    await act(async () => { root.render(<AppConfigTab appId="lights" />) });
    act(() => sock.current.onopen());
}

beforeEach(async () => {
    sock.copy = vi.fn(async () => { });
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove() });

describe('App Config tab', () => {
    it('subscribes to appConfig for its app and shows syncing first', async () => {
        await mount();
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'appConfig', params: { id: 'lights' } });
        expect(text()).toContain('Syncing');
    });

    it('shows the resolved config read-only, with default-sourced values annotated', async () => {
        await mount();
        await snapshot(snap());
        expect(text()).toContain('Resolved config');
        expect(text()).toContain('/w/lights.ts');
        expect(text()).toContain('// default');
        expect(host.querySelector('input, textarea')).toBeNull();
    });

    it('shows the source file with line and the edit note', async () => {
        await mount();
        await snapshot(snap());
        expect(text()).toContain('/config/typedaemon/config.yaml : 31');
        expect(text()).toContain('Edit in VS Code — saving the file reloads this app.');
    });

    it('copies just the file path, and confirms', async () => {
        await mount();
        await snapshot(snap());
        const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Copy path')!;
        await act(async () => { btn.click() });
        expect(sock.copy).toHaveBeenCalledWith('/config/typedaemon/config.yaml');
        expect(text()).toContain('Copied');
    });

    it('says so when copying fails', async () => {
        sock.copy = vi.fn(async () => { throw new Error('nope') });
        await mount();
        await snapshot(snap());
        await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Copy path')!.click() });
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't copy");
    });

    it('has no copy button when the file is unknown', async () => {
        await mount();
        await snapshot(snap({ file: undefined, line: undefined }));
        expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Copy path')).toBe(false);
    });

    it('shows the config as the server sent it (it redacts secrets)', async () => {
        await mount();
        await snapshot(snap({ config: { name: 'x', api_token: '***' }, defaults: [] }));
        expect(text()).toContain('"***"');
        expect(host.querySelector('button[aria-label="Reveal value"]')).toBeNull();
    });

    it('replaces the config when the server sends a fresh snapshot', async () => {
        await mount();
        await snapshot(snap());
        await serverSend({ type: 'delta', id: 1, data: snap({ config: { source: '/w/other.ts' }, defaults: [] }) });
        expect(text()).toContain('/w/other.ts');
        expect(text()).not.toContain('/w/lights.ts');
    });

    it('shows an error when the app is unknown', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' } as any);
        expect(text()).toContain("Couldn't load config");
    });
});
