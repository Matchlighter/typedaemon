// @vitest-environment happy-dom
import type { LogRow, ServerMessage } from '@protocol';
import { observable, runInAction } from 'mobx';
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

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
// Remounting subscribes again under a new id
const subId = () => sent().filter(m => m.type === 'subscribe').at(-1).id;
const snapshot = (entries: LogRow[]) => serverSend({ type: 'snapshot', id: subId(), data: { entries } });
const delta = (append: LogRow[]) => serverSend({ type: 'delta', id: subId(), data: { append } });
const lines = () => [...host.querySelectorAll('.log-msg')].map(e => e.textContent);

// Each test gets its own app: the view state outlives a mount by design
let fresh = 0;
async function mount(appId = `app${fresh++}`) {
    const { AppLogsTab } = await import('./AppLogsTab');
    await act(async () => { root.render(<AppLogsTab appId={appId} />) });
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

describe('App Logs tab', () => {
    it('subscribes to the logs of its app only, with a bounded history, and shows syncing first', async () => {
        await mount('my app');
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'logs', params: { sources: [{ kind: 'app', id: 'my app' }], limit: 10_000 } });
        expect(host.textContent).toContain('Syncing');
    });

    it('shows history, then live lines as they arrive', async () => {
        await mount();
        await snapshot([row(1), row(2)]);
        expect(lines()).toEqual(['line 1', 'line 2']);
        await delta([row(3, { message: 'live' })]);
        expect(lines()).toEqual(['line 1', 'line 2', 'live']);
    });

    it('ignores lines the snapshot already had', async () => {
        await mount();
        await snapshot([row(1), row(2)]);
        await delta([row(2), row(3)]);
        expect(lines()).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('filters apply to history and to the tail', async () => {
        await mount();
        await snapshot([row(1, { message: 'lamp on' }), row(2, { message: 'fan on' })]);
        const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'lamp');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(lines()).toEqual(['lamp on']);
        await delta([row(3, { message: 'fan off' }), row(4, { message: 'lamp off' })]);
        expect(lines()).toEqual(['lamp on', 'lamp off']);
    });

    it('keeps its filters when the tab is left and come back to', async () => {
        await mount('keeper');
        await snapshot([row(1), row(2, { channel: 'manager', message: 'td' })]);
        act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Manager')!.click());
        act(() => root.render(null));
        await mount('keeper');
        await snapshot([row(1), row(2, { channel: 'manager', message: 'td' })]);
        expect(lines()).toEqual(['td']);
    });

    it('opens on the newest error when linked with ?focus=error (error panel, Open logs)', async () => {
        runInAction(() => { sock.route.query.focus = 'error'; });
        await mount('focus');
        await snapshot([row(1, { level: 'error', message: 'startup failed', stack: [{ file: 'a.ts', line: 3 }] }), row(2, { message: 'later' })]);
        expect(host.querySelector('.log-focus .log-msg')!.textContent).toBe('startup failed');
        expect(host.querySelector('.log-stack')).not.toBeNull();
    });

    it('opens on the exact line a failure was linked to (?focus=<log id>), not the newest error', async () => {
        runInAction(() => { sock.route.query.focus = '1'; });
        await mount('focus-id');
        await snapshot([row(1, { level: 'error', message: 'the cause' }), row(2, { level: 'error', message: 'later error' })]);
        expect(host.querySelector('.log-focus .log-msg')!.textContent).toBe('the cause');
    });

    it('falls back to the newest error when the linked line has left the buffer', async () => {
        runInAction(() => { sock.route.query.focus = '999'; });
        await mount('focus-gone');
        await snapshot([row(1, { level: 'error', message: 'an error' }), row(2)]);
        expect(host.querySelector('.log-focus .log-msg')!.textContent).toBe('an error');
    });

    it('does not jump without ?focus=error', async () => {
        await mount('nofocus');
        await snapshot([row(1, { level: 'error', message: 'old error' }), row(2)]);
        expect(host.querySelector('.log-focus')).toBeNull();
    });

    it('starts following the tail again when you come back (a pause does not outlive the visit)', async () => {
        await mount('pausey');
        await snapshot([row(1)]);
        act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Pause tail')!.click());
        act(() => root.render(null));
        await mount('pausey');
        await snapshot([row(1)]);
        expect(host.textContent).toContain('Tailing');
    });
});
