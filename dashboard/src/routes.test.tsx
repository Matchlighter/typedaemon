// @vitest-environment happy-dom
import type { ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('./app', () => ({ app: { get connection() { return sock.connection }, system: { data: undefined }, chrome: { set: () => () => { } } } }));

let host: HTMLElement, root: Root;

beforeEach(async () => {
    const { ConnectionStore } = await import('./stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function renderRoute(segments: string[]) {
    const { routes } = await import('./routes');
    const def = routes.find(r => r.key === 'apps')!;
    await act(async () => { root.render(<>{def.render({ segments } as any)}</>) });
    act(() => sock.current.onopen());
}

describe('apps route', () => {
    it('shows the list at /apps', async () => {
        await renderRoute(['apps']);
        expect(sock.current.sent[0]).toMatchObject({ topic: 'apps' });
    });

    it('shows the detail page for /apps/<id>[/<tab>]', async () => {
        await renderRoute(['apps', 'my app', 'storage']);
        // The page first learns whether the id is an orphan; it is not
        expect(sock.current.sent[0]).toMatchObject({ topic: 'orphan', params: { id: 'my app' } });
        await act(async () => { sock.current.onmessage({ data: JSON.stringify({ type: 'snapshot', id: 1, data: { id: 'my app' } }) }) });
        expect(sock.current.sent[1]).toMatchObject({ topic: 'app', params: { id: 'my app' } });
        const msg: ServerMessage = { type: 'snapshot', id: sock.current.sent[1].id, data: { row: { id: 'my app', name: 'x', source: 's', state: 'started', since: 0 }, uuid: 'u', instanceOf: 's#default', packages: {}, watching: false, counts: {} } };
        await act(async () => { sock.current.onmessage({ data: JSON.stringify(msg) }) });
        expect(host.querySelector('[data-tabpanel="storage"]')).not.toBeNull();
    });
});

describe('plugins route', () => {
    async function renderPlugins(segments: string[]) {
        const { routes } = await import('./routes');
        const def = routes.find(r => r.key === 'plugins')!;
        await act(async () => { root.render(<>{def.render({ segments } as any)}</>) });
        act(() => sock.current.onopen());
    }

    it('shows the list at /plugins', async () => {
        await renderPlugins(['plugins']);
        expect(host.querySelector('h1')!.textContent).toBe('Plugins');
    });

    it('shows the list plus the inline detail panel at /plugins/<id>', async () => {
        await renderPlugins(['plugins', 'home assistant']);
        const msg: ServerMessage = { type: 'snapshot', id: 1, data: { plugins: [{ id: 'home assistant', type: 'home_assistant', state: 'started', since: 0, config: {} }] } };
        await act(async () => { sock.current.onmessage({ data: JSON.stringify(msg) }) });
        // The detail panel is a lazy chunk: poll for it instead of guessing how long the import takes
        const detail = () => host.querySelector('[aria-label="home assistant detail"]');
        for (let i = 0; i < 200 && !detail(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) });
        expect(host.querySelector('h1')!.textContent).toBe('Plugins');
        expect(detail()).not.toBeNull();
    });
});
