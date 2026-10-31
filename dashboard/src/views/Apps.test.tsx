// @vitest-environment happy-dom
import type { AppRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, system: { data: undefined as { configPath?: string } | undefined } }));
// `app` builds a real WebSocket-bound store; swap in one over a fake socket (fresh per test).
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, get system() { return sock.system } } }));

const row = (id: string, state: AppRow['state'] = 'started', over: Partial<AppRow> = {}): AppRow =>
    ({ id, name: id, source: `apps/${id}.ts`, state, since: Date.now() - 60_000, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const text = () => host.textContent!;
const rowFor = (id: string) => host.querySelector(`[data-app="${id}"]`) as HTMLElement;

async function mount() {
    const { Apps } = await import('./Apps');
    await act(async () => { root.render(<Apps />) });
    act(() => sock.current.onopen());
}
const SUMMARY = { removedAt: Date.now() - 26 * 60_000, entities: 3, storageKeys: 12, dirBytes: 48 * 1024, destroyers: ['mqtt_discovery_cleanup', 'remove_operating_dir'] };
const snapshot = (apps: AppRow[], orphans: string[] = []) =>
    serverSend({ type: 'snapshot', id: 1, data: { apps, orphans: orphans.map(id => ({ id, summary: SUMMARY })) } });

beforeEach(async () => {
    const { ConnectionStore } = await import('../stores/connection_store');
    sock.connection = new ConnectionStore({
        url: 'ws://x/ws',
        createSocket: () => (sock.current = { sent: [] as any[], send(r: string) { this.sent.push(JSON.parse(r)) }, close() { }, onopen: null, onclose: null, onmessage: null }),
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Apps view', () => {
    it('shows syncing until the first snapshot', async () => {
        await mount();
        expect(text()).toContain('Syncing');
    });

    it('footer names the config path, falling back to generic copy', async () => {
        await mount();
        await snapshot([]);
        expect(text()).toContain('declared in the TypeDaemon config file');
        sock.system.data = { configPath: '/config/typedaemon/config.yaml' };
        await mount();
        await snapshot([]);
        expect(host.querySelector('p.note .mono')!.textContent).toBe('/config/typedaemon/config.yaml');
        sock.system.data = undefined;
    });

    it('subscribes to the apps topic', async () => {
        await mount();
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'apps' });
    });

    it('lists apps with state, name, id, source, kind and counts', async () => {
        await mount();
        await snapshot([row('lights', 'started', { name: 'Lights', kind: 'thick', source: 'apps/lights/index.ts', resumables: 2, entities: 14 })]);
        const r = rowFor('lights');
        expect(r.textContent).toContain('started');
        expect(r.textContent).toContain('Lights');
        expect(r.textContent).toContain('apps/lights/index.ts');
        expect(r.textContent).toContain('thick');
        expect(r.textContent).toContain('14');
        expect(r.querySelector('a')!.getAttribute('href')).toBe('#/apps/lights');
    });

    it('shows unlinked entities under the count and a red Dead pill', async () => {
        await mount();
        await snapshot([row('lights', 'started', { entities: 14, unlinkedEntities: 1 }), row('broken', 'dead')]);
        expect(rowFor('lights').querySelector('.apps-unlinked')!.textContent).toBe('+1 unlinked');
        expect(rowFor('broken').querySelector('.apps-unlinked')).toBeNull();
        const dead = [...host.querySelectorAll('.seg button')].find(b => b.textContent!.startsWith('Dead'))!;
        expect(dead.querySelector('.cnt')!.classList.contains('cnt-e')).toBe(true);
    });

    it('restarts an app from its row and offers stop in the menu', async () => {
        await mount();
        await snapshot([row('lights')]);
        const btn = rowFor('lights').querySelector('[aria-label="Restart lights"]') as HTMLElement;
        await act(async () => { btn.click() });
        expect(sock.current.sent.at(-1)).toMatchObject({ type: 'call', action: 'app.restart', params: { id: 'lights' } });
        await act(async () => { (rowFor('lights').querySelector('[aria-label="More actions for lights"]') as HTMLElement).click() });
        const items = [...rowFor('lights').querySelectorAll('[role=menuitem]')].map(i => i.textContent);
        expect(items).toEqual(['Stop', 'Open logs']);
    });

    it('shows an error snippet for dead apps with the failed phase', async () => {
        await mount();
        await snapshot([row('broken', 'dead', { error: { message: 'Unexpected token }', phase: 'compiling' } })]);
        const r = rowFor('broken');
        expect(r.textContent).toContain('dead');
        expect(r.textContent).toContain('Unexpected token }');
        expect(r.querySelector('.apps-error')!.getAttribute('title')).toContain('compiling');
    });

    it('walks a row through hot-reload states live and flashes it', async () => {
        await mount();
        await snapshot([row('lights')]);
        for (const state of ['stopping', 'compiling', 'starting', 'started'] as const) {
            await serverSend({ type: 'delta', id: 1, data: { upsert: [row('lights', state)] } });
            expect(rowFor('lights').textContent).toContain(state);
            expect(rowFor('lights').classList.contains(state === 'started' ? 'flash-ok' : 'flash')).toBe(true);
            const settling = state === 'compiling' || state === 'starting';
            expect(rowFor('lights').querySelectorAll('td.num')[0].textContent).toBe(settling ? '…' : '—');
        }
    });

    it('adds and removes apps live', async () => {
        await mount();
        await snapshot([row('a')]);
        await serverSend({ type: 'delta', id: 1, data: { upsert: [row('b')] } });
        expect(rowFor('b')).toBeTruthy();
        await serverSend({ type: 'delta', id: 1, data: { remove: ['a'] } });
        expect(rowFor('a')).toBeNull();
    });

    it('groups orphans separately with a Clean up entry point', async () => {
        await mount();
        await snapshot([row('a')], ['old_presence']);
        const orphans = host.querySelector('.apps-orphans') as HTMLElement;
        expect(orphans.textContent).toContain('old_presence');
        expect(rowFor('old_presence')).toBeNull();
        const clean = [...orphans.querySelectorAll('a')].find(a => a.textContent!.includes('Clean up'))!;
        expect(clean.getAttribute('href')).toBe('#/apps/old_presence/cleanup');
        expect(clean.classList.contains('btn-danger-outline')).toBe(true);
    });

    it('shows when it was removed, its leftovers and pending destroyers, and links to them', async () => {
        await mount();
        await snapshot([row('a')], ['old_presence']);
        const tr = host.querySelector('[data-orphan="old_presence"]') as HTMLElement;
        expect(tr.textContent).toContain('26 min ago');
        expect([...tr.querySelectorAll('.chip')].map(c => c.textContent)).toEqual(['3 HA entities', 'storage 12 keys', 'dir 48.0 KB']);
        expect(tr.textContent).toContain('mqtt_discovery_cleanup, remove_operating_dir');
        const view = [...tr.querySelectorAll('a')].find(a => a.textContent === 'View leftovers')!;
        expect(view.getAttribute('href')).toBe('#/apps/old_presence/leftovers');
    });

    it('still lists an orphan whose leftovers could not be read', async () => {
        await mount();
        await serverSend({ type: 'snapshot', id: 1, data: { apps: [], orphans: [{ id: 'gone' }] } });
        expect(host.querySelector('[data-orphan="gone"]')!.textContent).toContain('Clean up');
    });

    it('has no orphans card without orphans', async () => {
        await mount();
        await snapshot([row('a')]);
        expect(host.querySelector('.apps-orphans')).toBeNull();
    });

    it('explains an empty config', async () => {
        await mount();
        await snapshot([]);
        expect(text()).toContain('No apps configured');
    });

    it('filters by segment and text', async () => {
        await mount();
        await snapshot([row('lights'), row('broken', 'dead'), row('heat')]);
        const seg = [...host.querySelectorAll('.seg button')].find(b => b.textContent!.startsWith('Dead'))!;
        await act(async () => { (seg as HTMLElement).click() });
        expect(rowFor('broken')).toBeTruthy();
        expect(rowFor('lights')).toBeNull();
        const all = [...host.querySelectorAll('.seg button')].find(b => b.textContent!.startsWith('All'))!;
        await act(async () => { (all as HTMLElement).click() });
        const input = host.querySelector('input[type=search]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'hea');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(rowFor('heat')).toBeTruthy();
        expect(rowFor('lights')).toBeNull();
    });

    it('says when filters hide everything', async () => {
        await mount();
        await snapshot([row('a')]);
        const seg = [...host.querySelectorAll('.seg button')].find(b => b.textContent!.startsWith('Dead'))!;
        await act(async () => { (seg as HTMLElement).click() });
        expect(text()).toContain('No matching apps');
    });

    it('dims the list when the connection is stale', async () => {
        await mount();
        await snapshot([row('a')]);
        await act(async () => { sock.current.onclose() });
        expect(host.querySelector('.liststate-stale')).toBeTruthy();
        expect(rowFor('a')).toBeTruthy();
    });

    it('shows the server error', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'boom' });
        expect(text()).toContain('boom');
    });

    it('badges apps stopped from the dashboard as override', async () => {
        await mount();
        await snapshot([row('lights', 'stopped', { stoppedOverride: true }), row('other', 'stopped')]);
        expect(rowFor('lights').querySelector('.badge')!.textContent).toBe('stopped · override');
        expect(rowFor('other').querySelector('.badge')!.textContent).toBe('stopped');
    });
});
