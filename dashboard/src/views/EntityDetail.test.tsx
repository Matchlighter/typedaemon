// @vitest-environment happy-dom
import type { EntityDetail, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any, system: { data: undefined as { haBaseUrl?: string } | undefined } }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, system: sock.system } }));

const detail = (over: Partial<EntityDetail> = {}): EntityDetail => ({
    key: 'lights/ha:abc', entityKey: 'ha:abc', app: 'lights', plugin: 'ha', domain: 'sensor', entityId: 'sensor.power', name: 'Power',
    state: '42', linked: true, autoClean: true, persistState: false,
    attributes: { unit_of_measurement: 'W' }, lastChanged: '2026-10-29T10:00:00Z', lastUpdated: '2026-10-29T10:00:05Z', ...over,
});

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const text = () => host.textContent!;

async function mount() {
    const { EntityPanel } = await import('./EntityDetail');
    await act(async () => { root.render(<EntityPanel id="lights/ha:abc" />) });
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
afterEach(() => { act(() => root.unmount()); host.remove(); sock.system.data = undefined });

describe('EntityPanel', () => {
    it('subscribes to the entity by row key and shows syncing first', async () => {
        await mount();
        expect(sock.current.sent[0]).toMatchObject({ type: 'subscribe', topic: 'entity', params: { id: 'lights/ha:abc' } });
        expect(text()).toContain('Syncing entity');
    });

    it('shows state, owner, flags and attributes', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        expect(host.querySelector('h2')!.textContent).toBe('Power');
        expect(text()).toContain('42');
        expect(text()).toContain('auto_clean');
        expect(text()).not.toContain('persist_state');
        expect(host.querySelector<HTMLAnchorElement>('a[href="#/apps/lights"]')).toBeTruthy();
        expect(text()).toContain('unit_of_measurement');
    });

    it('follows live updates (full snapshot replaces: cleared attributes go away)', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        serverSend({ type: 'delta', id: 1, data: detail({ state: '50', attributes: undefined }) });
        expect(text()).toContain('50');
        expect(text()).not.toContain('unit_of_measurement');
        expect(text()).toContain('no attributes');
    });

    it('an unlinked entity has no live state', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail({ linked: false, state: undefined, attributes: undefined }) });
        expect(host.querySelector('.entity-state')!.textContent).toBe('unavailable');
        expect(text()).toContain('Not in Home Assistant');
    });

    it('links to the entity in HA when the base URL is known, and not otherwise', async () => {
        sock.system.data = { haBaseUrl: 'https://ha.example.com' };
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        expect(host.querySelector<HTMLAnchorElement>('a.entp-ha')!.href).toBe('https://ha.example.com/config/entities?search=sensor.power');
        serverSend({ type: 'delta', id: 1, data: detail({ entityId: undefined }) });
        expect(host.querySelector('a.entp-ha')).toBeNull();
    });

    it('has no HA link without a base URL', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        expect(host.querySelector('a.entp-ha')).toBeNull();
    });

    it('marks an orphan owner', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail({ orphan: true }) });
        expect(text()).toContain('lights (orphan)');
    });

    it('unknown entity is an error state with the server message', async () => {
        await mount();
        serverSend({ type: 'error', id: 1, message: 'Unknown entity: lights/ha:abc' } as any);
        expect(host.querySelector('[role="alert"]')!.textContent).toContain("Couldn't load entity");
        expect(text()).toContain('Unknown entity: lights/ha:abc');
    });

    it('dims stale data when the connection drops', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        act(() => sock.current.onclose());
        expect(host.querySelector('.liststate-stale')).toBeTruthy();
        expect(text()).toContain('42');
    });
});

describe('EntityPanel chrome', () => {
    it('shows changed-ago beside the state and a close link back to the list', async () => {
        await mount();
        serverSend({ type: 'snapshot', id: 1, data: detail() });
        expect(host.querySelector('.entp-changed')!.textContent).toContain('changed');
        expect(host.querySelector<HTMLAnchorElement>('a[aria-label="Close detail"]')!.getAttribute('href')).toBe('#/entities');
    });

    describe('when the owning HA plugin is down', () => {
        const pluginRow = (connection: string) => ({ id: 'ha', type: 'home_assistant', state: 'started', since: 0, connection });
        const plugins = (connection: string) => serverSend({ type: 'snapshot', id: 2, data: { plugins: [pluginRow(connection)] } });

        it('dims the panel with a note, and recovers on reconnect', async () => {
            await mount();
            serverSend({ type: 'snapshot', id: 1, data: detail() });
            plugins('connected');
            expect(host.querySelector('.liststate-stale')).toBeNull();
            expect(text()).not.toContain('link down');

            serverSend({ type: 'snapshot', id: 2, data: { plugins: [pluginRow('reconnecting')] } });
            expect(host.querySelector('.liststate-stale')).toBeTruthy();
            expect(text()).toContain('Home Assistant link down (ha)');

            serverSend({ type: 'snapshot', id: 2, data: { plugins: [pluginRow('connected')] } });
            expect(host.querySelector('.liststate-stale')).toBeNull();
            expect(text()).not.toContain('link down');
        });
    });
});
