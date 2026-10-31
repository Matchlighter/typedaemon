// @vitest-environment happy-dom
import type { ResumableRow, ScriptRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

const res = (key: string, over: Partial<ResumableRow> = {}): ResumableRow =>
    ({ key, status: 'running', type: 'resumable', owner: 'hvac', method: 'preheat', params: ['bedroom', 21], startedAt: Date.now() - 3600_000, restarts: 0, ...over });
const failed = (key: string) => res(key, { status: 'failed', failure: { error: 'Control flow was obviously changed!', attempts: 3 } });
const scr = (key: string, over: Partial<ScriptRow> = {}): ScriptRow =>
    ({ key, mode: 'queued', limit: 5, running: 0, queued: 0, runs: [], ...over });
const run = (id: string, over: object = {}) => ({ id, params: ['evening'], startedAt: Date.now() - 47_000, queued: false, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (resumables: ResumableRow[], scripts: ScriptRow[] = []) => serverSend({ type: 'snapshot', id: 1, data: { resumables, scripts } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const cards = () => [...host.querySelectorAll('.resumable-card')];
const button = (re: RegExp, within: ParentNode = host) => [...within.querySelectorAll('button')].find(b => re.test(b.textContent!)) as HTMLButtonElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click() });
const scriptRows = () => [...host.querySelectorAll('tr[data-script]')];

async function mount() {
    const { AppResumablesTab } = await import('./AppResumablesTab');
    await act(async () => { root.render(<AppResumablesTab appId="lights" />) });
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

describe('App resumables tab: resumables', () => {
    it('subscribes to appResumables for its app and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'appResumables', params: { id: 'lights' } });
        expect(host.textContent).toContain('Syncing');
    });

    it('groups running, suspended and failed resumables with their call', async () => {
        await mount();
        await snapshot([res('1'), res('2', { status: 'suspended' }), failed('3')]);
        const headings = [...host.querySelectorAll('[data-group] h3')].map(h => h.textContent);
        expect(headings).toEqual([expect.stringContaining('Running'), expect.stringContaining('Suspended'), expect.stringContaining('Failed to resume')]);
        expect(cards()).toHaveLength(3);
        expect(cards()[0].textContent).toContain('hvac:preheat(["bedroom", 21])');
        expect(cards()[2].textContent).toContain('Control flow was obviously changed!');
        expect(cards()[2].textContent).toContain('3 attempts');
    });

    it('shows what a resumable waits on', async () => {
        await mount();
        await snapshot([res('1', { wait: { kind: 'condition', condition: 'ac.is_on', since: Date.now() - 60_000 } })]);
        expect(cards()[0].textContent).toContain('Waiting for');
        expect(cards()[0].textContent).toContain('ac.is_on');
    });

    it('resumables appear and disappear live', async () => {
        await mount();
        await snapshot([res('1')]);
        await delta({ resumables: { upsert: [res('2', { method: 'cooldown' })] } });
        expect(cards()).toHaveLength(2);
        await delta({ resumables: { remove: ['1', '2'] } });
        expect(cards()).toHaveLength(0);
        expect(host.textContent).toContain('No resumables running');
    });

    it('offers Cancel on running ones, Discard on failed ones and nothing on suspended ones', async () => {
        await mount();
        await snapshot([res('1'), res('2', { status: 'suspended' }), failed('3')]);
        expect(button(/Cancel…/, cards()[0])).toBeTruthy();
        expect(cards()[1].querySelector('button')).toBeNull();
        expect(button(/Discard…/, cards()[2])).toBeTruthy();
        expect(button(/Cancel…/, cards()[2])).toBeFalsy();
    });

    it('confirms before cancelling, naming the call; backing out sends nothing', async () => {
        await mount();
        await snapshot([res('1')]);
        click(button(/Cancel…/, cards()[0]));
        const dialog = host.querySelector('dialog')!;
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.textContent).toContain('hvac:preheat');
        expect(dialog.textContent).toMatch(/Will/);
        expect(dialog.textContent).toMatch(/Won't/);
        click(button(/^Cancel$/, dialog));
        expect(sent().filter(m => m.type === 'call')).toEqual([]);
    });

    it('confirming Cancel calls resumable.cancel for that row', async () => {
        await mount();
        await snapshot([res('1'), res('2')]);
        click(button(/Cancel…/, cards()[1]));
        click(button(/Cancel resumable/, host.querySelector('dialog')!));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'resumable.cancel', params: { app: 'lights', key: '2' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        expect(host.querySelector('dialog')!.hasAttribute('open')).toBe(false);
    });

    it('confirming Discard calls resumable.discard and explains it will not be retried', async () => {
        await mount();
        await snapshot([failed('3')]);
        click(button(/Discard…/, cards()[0]));
        const dialog = host.querySelector('dialog')!;
        expect(dialog.textContent).toMatch(/retried/i);
        click(button(/^Discard$/, dialog));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'resumable.discard', params: { app: 'lights', key: '3' } });
    });

    it('shows the server error when it fails and keeps the card', async () => {
        await mount();
        await snapshot([res('1')]);
        click(button(/Cancel…/, cards()[0]));
        click(button(/Cancel resumable/, host.querySelector('dialog')!));
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: false, message: 'The app is shutting down' });
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('shutting down');
        expect(cards()).toHaveLength(1);
    });

    it('shows the empty-state copy from the design', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No resumables running');
        expect(host.textContent).toContain('Calls to @resumable methods');
        expect(host.querySelector('.liststate-center.card svg')).toBeTruthy();
    });

    it('shows the topic error', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' });
        expect(host.textContent).toContain("Couldn't load resumables");
        expect(host.textContent).toContain('Unknown app: lights');
    });
});

describe('App resumables tab: scripts', () => {
    it('tabulates scripts with mode, running against limit, queued and the current run', async () => {
        await mount();
        await snapshot([], [scr('scene', { running: 1, queued: 2, runs: [run('9'), run('10', { queued: true }), run('11', { queued: true })] }), scr('free', { mode: 'parallel', limit: null })]);
        const [free, scene] = scriptRows();
        expect(scene.textContent).toContain('scene');
        expect(scene.textContent).toContain('queued');
        expect(scene.querySelector('[data-label="Running"]')!.textContent).toBe('1 / 5');
        expect(scene.querySelector('[data-label="Queued"]')!.textContent).toBe('2');
        expect(scene.textContent).toContain('scene("evening")');
        expect(free.querySelector('[data-label="Running"]')!.textContent).toBe('0 / ∞');
    });

    it('shows a running meter against the limit and idle for scripts with no run', async () => {
        await mount();
        await snapshot([], [scr('scene', { mode: 'restart', limit: 2, running: 1, runs: [run('9')] }), scr('free', { mode: 'parallel', limit: null })]);
        const [free, scene] = scriptRows();
        expect((scene.querySelector('.rsm-meter > span') as HTMLElement).style.width).toBe('50%');
        expect(free.querySelector('.rsm-meter')).toBeNull();
        expect(free.textContent).toContain('idle');
        expect(scene.textContent).not.toContain('idle');
    });

    it('updates counts live', async () => {
        await mount();
        await snapshot([], [scr('scene')]);
        await delta({ scripts: { upsert: [scr('scene', { running: 3, queued: 1, runs: [run('1'), run('2'), run('3'), run('4', { queued: true })] })] } });
        expect(scriptRows()[0].querySelector('[data-label="Running"]')!.textContent).toBe('3 / 5');
        expect(scriptRows()[0].querySelector('[data-label="Queued"]')!.textContent).toBe('1');
    });

    it('offers Cancel run only on running runs, confirms, then calls script.cancel', async () => {
        await mount();
        await snapshot([], [scr('scene', { running: 1, queued: 1, runs: [run('9'), run('10', { queued: true })] })]);
        expect(scriptRows()[0].querySelectorAll('button')).toHaveLength(1);
        click(button(/Cancel run…/, scriptRows()[0]));
        const dialog = host.querySelector('dialog')!;
        expect(dialog.textContent).toContain('scene("evening")');
        click(button(/Cancel run$/, dialog));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'script.cancel', params: { app: 'lights', script: 'scene', run: '9' } });
    });

    it('shows an empty state when the app defines no scripts', async () => {
        await mount();
        await snapshot([res('1')], []);
        expect(host.textContent).toContain('No scripts');
    });
});
