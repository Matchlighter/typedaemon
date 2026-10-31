// @vitest-environment happy-dom
import type { HttpRouteRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

const row = (key: string, over: Partial<HttpRouteRow> = {}): HttpRouteRow =>
    ({ key, kind: 'route', method: 'GET', path: '/api/scenes', handler: 'list_scenes', url: '/app/lights/api/scenes', ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (rows: HttpRouteRow[], port: number | undefined = 9000) => serverSend({ type: 'snapshot', id: 1, data: { port, rows } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const rowEls = () => [...host.querySelectorAll('tbody tr')];
const cells = (tr: Element) => [...tr.querySelectorAll('td')].slice(0, 4).map(td => td.textContent);

async function mount() {
    const { AppHttpTab } = await import('./AppHttpTab');
    await act(async () => { root.render(<AppHttpTab appId="lights" />) });
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
afterEach(() => { act(() => root.unmount()); host.remove() });

describe('App HTTP tab', () => {
    it('subscribes to appHttp for its app and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'appHttp', params: { id: 'lights' } });
        expect(host.textContent).toContain('Syncing');
    });

    it('lists routes with method, path, handler and the full URL', async () => {
        await mount();
        await snapshot([row('1'), row('2', { method: 'POST', path: '/api/scenes/:id', handler: 'save', url: '/app/lights/api/scenes/:id' })]);
        expect([...host.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['Method', 'Path', 'Handler / mount', 'URL', '']);
        expect(cells(rowEls()[0])).toEqual(['GET', '/api/scenes', 'list_scenes', `${location.protocol}//${location.hostname}:9000/app/lights/api/scenes`]);
        expect(cells(rowEls()[1])).toEqual(['POST', '/api/scenes/:id', 'save', `${location.protocol}//${location.hostname}:9000/app/lights/api/scenes/:id`]);
    });

    it('lists static mounts as STATIC with the directory they serve', async () => {
        await mount();
        await snapshot([row('1', { kind: 'static', method: undefined, path: '/ui', handler: 'apps/lights/ui', url: '/app/lights/ui' })]);
        expect(cells(rowEls()[0]).slice(0, 3)).toEqual(['STATIC', '/ui/*', 'apps/lights/ui']);
        expect(cells(rowEls()[0])[3]).toMatch(/:9000\/app\/lights\/ui\/$/);
    });

    it('shows the URL as plain text with a copy button, and tints methods', async () => {
        await mount();
        await snapshot([row('1'), row('2', { method: 'POST' })]);
        const url = `${location.protocol}//${location.hostname}:9000/app/lights/api/scenes`;
        expect(rowEls()[0].querySelector('a')).toBeNull();
        const writeText = vi.fn(async () => { });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await act(async () => { (rowEls()[0].querySelector('button[aria-label="Copy URL"]') as HTMLElement).click() });
        expect(writeText).toHaveBeenCalledWith(url);
        expect(rowEls()[0].querySelector('.chip')!.className).toContain('chip-ok');
        expect(rowEls()[1].querySelector('.chip')!.className).toContain('chip-run');
    });

    it('refreshes when the app restarts: old routes drop, new ones appear in registration order', async () => {
        await mount();
        await snapshot([row('1', { handler: 'first' })]);
        await delta({ remove: ['1'] });
        expect(host.textContent).toContain('No HTTP handlers');
        await delta({ upsert: [row('12', { handler: 'later' }), row('3', { handler: 'earlier' })] });
        expect(rowEls().map(r => cells(r)[2])).toEqual(['earlier', 'later']);
    });

    it('shows the empty state copy', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No HTTP handlers');
        expect(host.textContent).toContain('Routes appear when the app calls this.http.get() or mounts static files.');
        expect(rowEls()).toHaveLength(0);
    });

    it('shows the error state when the subscription fails', async () => {
        await mount();
        serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' } as any);
        expect(host.textContent).toContain("Couldn't load HTTP handlers");
        expect(host.textContent).toContain('Unknown app: lights');
    });
});
