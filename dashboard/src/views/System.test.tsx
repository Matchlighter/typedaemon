// @vitest-environment happy-dom
import type { CrossCallRow, ServerMessage, SystemSnapshot } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, system: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, get system() { return sock.system } } }));

const copyText = vi.hoisted(() => vi.fn(async (_t: string) => { }));
vi.mock('../components/clipboard', () => ({ copyText }));

const info = (over: Partial<SystemSnapshot> = {}): SystemSnapshot =>
    ({ version: 'v1', nodeVersion: '22.11.0', startedAt: Date.now(), now: Date.now(), state: 'running', crossCalls: [], ...over });
const call = (uuid: string, over: Partial<CrossCallRow> = {}): CrossCallRow =>
    ({ uuid, source: 'lights', target: 'door', method: 'open', status: 'pending', targetState: 'started', since: Date.now() - 60_000, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const text = () => host.textContent!;
const openStore = async () => { await act(async () => { (host.querySelector('[data-store] button') as HTMLElement).click() }) };
const subId = (stores: boolean) => sock.current.sent.find((m: any) => m.topic === 'system' && !!m.params?.stores === stores).id;
/** The app-wide light subscription and the System page's stores part each get the same snapshot (as the server would send) */
const snapshotInfo = async (s: SystemSnapshot) => {
    await serverSend({ type: 'snapshot', id: subId(false), data: { ...s, stores: undefined } });
    await serverSend({ type: 'snapshot', id: subId(true), data: { ...s, stores: s.stores ?? [] } });
};

beforeEach(async () => {
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    const { TopicStore } = await import('../stores/topic_store');
    sock.system = new TopicStore(sock.connection, 'system');
    sock.system.activate();
    const { System } = await import('./System');
    await act(async () => { root.render(<System />) });
    act(() => sock.current.onopen());
});
afterEach(() => { act(() => root.unmount()); host.remove(); copyText.mockClear() });

describe('System view', () => {
    it('shares the app-wide system subscription and adds the stores part, syncing first', () => {
        expect(sock.current.sent.map((m: any) => [m.topic, m.params])).toEqual([['system', undefined], ['system', { stores: true }]]);
        expect(text()).toContain('Syncing');
    });

    it('shows the resolved config as a read-only card', async () => {
        await snapshotInfo(info({ resolvedConfig: { timezone: 'America/Denver', apps: ['lights'] } }));
        expect(text()).toContain('Resolved system config');
        expect(text()).toContain('read-only');
        expect(text()).toContain('America/Denver');
    });

    it('shows version, uptime, state, config path and location', async () => {
        await snapshotInfo(info({ version: 'v1.2.3', startedAt: Date.now() - 3_600_000, configPath: '/cfg/typedaemon.yaml', location: { timezone: 'Europe/Paris', latitude: 48.85, longitude: 2.35 } }));
        const t = text();
        expect(t).toContain('v1.2.3');
        expect(t).toContain('Hypervisor');
        expect(t).toContain('node 22.11');
        expect(t).toContain('1h 0m');
        expect(t).toContain('running');
        expect(t).toContain('/cfg/typedaemon.yaml');
        expect(t).toContain('Europe/Paris');
        expect(t).toContain('48.85');
    });

    it('copies the config path', async () => {
        await snapshotInfo(info({ configPath: '/cfg/typedaemon.yaml' }));
        const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Copy path')!;
        await act(async () => { btn.click() });
        expect(copyText).toHaveBeenCalledWith('/cfg/typedaemon.yaml');
        expect(btn.textContent).toBe('Copied');
    });

    it('browses shared stores: name, path and values', async () => {
        await snapshotInfo(info({ stores: [{ name: 'default', path: '.typedaemon/shared_storage/default.jkv', usedBy: ['lights', 'hvac'], rows: [{ key: 'greeting', value: 'hello there', size: 13, writtenAt: 1, internal: false }] }] }));
        const t0 = text();
        expect(t0).toContain('lights');
        expect(t0).toContain('13 B');
        expect(t0).not.toContain('hello there');
        await openStore();
        const t = text();
        expect(t).toContain('default');
        expect(t).toContain('.typedaemon/shared_storage/default.jkv');
        expect(t).toContain('greeting');
        expect(t).toContain('hello there');
    });

    it('fetches a lazy shared value through the sharedStorage.value action', async () => {
        await snapshotInfo(info({ stores: [{ name: 'default', path: 'p', usedBy: [], rows: [{ key: 'big', lazy: { kind: 'object', count: 2, size: 99999 }, size: 99999, writtenAt: 1, internal: false }] }] }));
        await openStore();
        const row = host.querySelector('.skey-row')!;
        const toggle = row.querySelector('.json-toggle')!;
        await act(async () => { (toggle as HTMLElement).click() });
        const req = sock.current.sent.find((m: any) => m.type === 'call');
        expect(req).toMatchObject({ action: 'sharedStorage.value', params: { store: 'default', key: 'big' } });
    });

    it('lists stores as shared:<name>, hiding empty stores with at most one user', async () => {
        const row = { key: 'k', value: 1, size: 1, writtenAt: 1, internal: false };
        await snapshotInfo(info({ stores: [
            { name: 'multi', path: 'p', usedBy: ['a', 'b'], rows: [] },
            { name: 'solo_data', path: 'p', usedBy: ['a'], rows: [row] },
            { name: 'solo_empty', path: 'p', usedBy: ['a'], rows: [] },
            { name: 'unused', path: 'p', usedBy: [], rows: [] },
        ] }));
        const t = text();
        expect(t).toContain('shared:multi');
        expect(t).toContain('shared:solo_data');
        expect(t).not.toContain('solo_empty');
        expect(t).not.toContain('shared:unused');
        expect(t).toContain('Stores used by more than one app');
    });

    it('says when there are no shared stores keys or calls', async () => {
        await snapshotInfo(info({ stores: [{ name: 'default', path: 'p', usedBy: ['a', 'b'], rows: [] }] }));
        await openStore();
        expect(text()).toContain('No stored keys');
        expect(text()).toContain('No pending cross-app calls');
    });

    it('lists calls source → target, method, status, age, timeout', async () => {
        await snapshotInfo(info({ crossCalls: [call('u1', { timeoutAt: Date.now() + 5 * 60_000 })] }));
        const r = host.querySelector('[data-call="u1"]') as HTMLElement;
        expect(r.textContent).toContain('lights');
        expect(r.textContent).toContain('door');
        expect(r.textContent).toContain('open');
        expect(r.textContent).toContain('pending');
        expect(r.textContent).toContain('1 min ago');
        expect(r.textContent).toContain('in 4m');
        expect(r.hasAttribute('data-stuck')).toBe(false);
    });

    it('highlights a pending call stuck on a dead target, linking to it', async () => {
        await snapshotInfo(info({ crossCalls: [call('u1', { targetState: 'dead' }), call('u2')] }));
        const stuck = host.querySelector('[data-call="u1"]') as HTMLElement;
        expect(stuck.hasAttribute('data-stuck')).toBe(true);
        expect(stuck.textContent).toContain('Target door is dead');
        expect(stuck.querySelector('a[href="#/apps/door"]')).toBeTruthy();
        expect(host.querySelector('[data-call="u2"]')!.hasAttribute('data-stuck')).toBe(false);
    });

    it('shows count, args and a status badge per call', async () => {
        await snapshotInfo(info({ crossCalls: [call('u1', { args: '"Scene: evening"' }), call('u2', { status: 'returning' })] }));
        expect(host.querySelector('[aria-label="Cross-app calls"] .cnt')!.textContent).toBe('2');
        expect(host.querySelector('[data-call="u1"]')!.textContent).toContain('lights→door.open("Scene: evening")');
        expect(host.querySelector('[data-call="u2"] td:nth-child(2)')!.textContent).toContain('returning');
    });

    it('cancels a pending call after confirmation; other statuses have no Cancel', async () => {
        await snapshotInfo(info({ crossCalls: [call('u1'), call('u2', { status: 'started' })] }));
        expect(host.querySelector('[data-call="u2"] button')).toBeNull();
        await act(async () => { (host.querySelector('[data-call="u1"] button') as HTMLElement).click() });
        expect(sock.current.sent.some((m: any) => m.action === 'crossCall.cancel')).toBe(false);
        await act(async () => { ([...host.querySelectorAll('dialog button')].find(b => b.textContent === 'Cancel call') as HTMLElement).click() });
        expect(sock.current.sent.find((m: any) => m.action === 'crossCall.cancel').params).toEqual({ uuid: 'u1' });
    });

    it('updates live with the next snapshot', async () => {
        await snapshotInfo(info({ crossCalls: [call('u1')] }));
        await serverSend({ type: 'delta', id: subId(false), data: info({ state: 'shutting_down', crossCalls: [] }) });
        expect(host.querySelector('[data-call="u1"]')).toBeNull();
        expect(text()).toContain('shutting down');
    });
});
