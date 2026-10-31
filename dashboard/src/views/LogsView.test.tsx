// @vitest-environment happy-dom
import type { LogRow, ServerMessage } from '@protocol';
import { observable } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, route: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, get route() { return sock.route } } }));

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(25);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return parseInt((this.firstElementChild as HTMLElement | null)?.style.height || '0');
    });
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts: any) { this.scrollTop = opts.top; this.dispatchEvent(new Event('scroll')) } as any;
});

const row = (id: number, over: Partial<LogRow> = {}): LogRow => ({ id, ts: id, level: 'info', source: { kind: 'app', id: 'lights' }, channel: 'user', message: `line ${id}`, ...over });
const plug = (id: number, message = `plug ${id}`): LogRow => row(id, { source: { kind: 'plugin', id: 'ha' }, message });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const subId = () => sock.current.sent.filter((m: any) => m.type === 'subscribe').at(-1).id;
const snapshot = (entries: LogRow[]) => serverSend({ type: 'snapshot', id: subId(), data: { entries } });
const delta = (append: LogRow[]) => serverSend({ type: 'delta', id: subId(), data: { append } });
const lines = () => [...host.querySelectorAll('.log-msg')].map(e => e.textContent);
const button = (label: string | RegExp) => [...host.querySelectorAll('button')].find(b => typeof label === 'string' ? b.textContent === label : label.test(b.textContent!))!;

let fresh = 0;
async function mount(props: object = {}) {
    const { LogsView } = await import('./LogsView');
    await act(async () => { root.render(<LogsView viewKey={`v${fresh++}`} {...props} />) });
    act(() => sock.current.onopen());
}

beforeEach(async () => {
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    sock.route = observable({ query: {} as Record<string, string> });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() });

describe('LogsView', () => {
    it('subscribes to the given sources', async () => {
        await mount({ sources: [{ kind: 'plugin', id: 'ha' }] });
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'logs', params: { sources: [{ kind: 'plugin', id: 'ha' }], limit: 10_000 } });
    });

    it('subscribes to every source when none are given', async () => {
        await mount();
        expect(sock.current.sent[0].params.sources).toBeUndefined();
    });

    it('merges sources in time order, history then live', async () => {
        await mount({ sourceFilter: true });
        await snapshot([row(1), plug(2, 'plug'), row(3, { source: { kind: 'system', id: 'hypervisor' }, message: 'sys' })]);
        expect(lines()).toEqual(['line 1', 'plug', 'sys']);
        await delta([row(4, { message: 'live' })]);
        expect(lines()).toEqual(['line 1', 'plug', 'sys', 'live']);
    });

    it('filters by source kind, applying to the tail too', async () => {
        await mount({ sourceFilter: true });
        await snapshot([row(1), plug(2, 'plug')]);
        act(() => (host.querySelector('[aria-label="Hide all apps"]') as HTMLElement).click());
        expect(lines()).toEqual(['plug']);
        await delta([row(3), plug(4, 'plug2')]);
        expect(lines()).toEqual(['plug', 'plug2']);
    });

    it('pauses and resumes the tail', async () => {
        await mount();
        await snapshot([row(1)]);
        act(() => button('Pause').click());
        await delta([row(2)]);
        expect(lines()).toEqual(['line 1']);
        act(() => button(/^Resume/).click());
        expect(lines()).toEqual(['line 1', 'line 2']);
    });
});
