// @vitest-environment happy-dom
import type { EntityRow, OrphanLeftovers, OrphanSnapshot, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', async () => {
    const { PageChrome } = await import('../stores/page_chrome');
    const { RouteStore } = await import('../stores/route_store');
    let hash = '#/apps/old_presence';
    const route = new RouteStore({ get hash() { return hash }, set hash(v: string) { hash = v }, onChange: () => () => { } });
    return { app: { chrome: new PageChrome(), route, get connection() { return sock.connection }, get system() { return { data: undefined } } } };
});

const ent = (n: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key: `ha:${n}`, plugin: 'ha', domain: 'binary_sensor', entityId: `binary_sensor.${n}`, linked: false, autoClean: true, persistState: false, ...over });

const leftovers = (over: Partial<OrphanLeftovers> = {}): OrphanLeftovers => ({
    dir: { path: '.typedaemon/app_environments/old_presence', bytes: 49152, files: 7 },
    storage: [
        { key: 'last_seen', value: 'kitchen', size: 9, writtenAt: Date.now() - 60_000, internal: false },
        { key: '_destroyers', value: {}, size: 2, writtenAt: Date.now() - 60_000, internal: true },
    ],
    entities: [ent('old_presence_home'), ent('old_presence_away')],
    destroyers: [{ uuid: 'HAEntities-1', type: 'HAEntities', options: { plugin_id: 'home_assistant' } }],
    ...over,
});
const orphan = (l: OrphanLeftovers | undefined = leftovers()): OrphanSnapshot => ({ id: 'old_presence', leftovers: l });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const calls = () => sent().filter(m => m.type === 'call');
const snapshot = (d: OrphanSnapshot, id = 1) => serverSend({ type: 'snapshot', id, data: d });
const delta = (d: OrphanSnapshot) => serverSend({ type: 'delta', id: 1, data: d });
const button = (re: RegExp, within: ParentNode = host) => [...within.querySelectorAll('button')].find(b => re.test(b.textContent!)) as HTMLButtonElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click() });
const text = () => host.textContent!;

async function mount(tab?: string) {
    const { AppRoute } = await import('./AppRoute');
    await act(async () => { root.render(<AppRoute id="old_presence" tab={tab} />) });
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

describe('app route', () => {
    it('asks whether the id is an orphan first, showing syncing meanwhile', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'orphan', params: { id: 'old_presence' } });
        expect(text()).toContain('Syncing');
        expect(sent().filter(m => m.topic === 'app')).toEqual([]);
    });

    it('shows the regular app page for an id without leftovers', async () => {
        await mount();
        await snapshot({ id: 'old_presence' });
        expect(sent().find(m => m.topic === 'app')).toMatchObject({ params: { id: 'old_presence' } });
    });

    it('shows the Apps list with the leftovers modal over it when there are leftovers', async () => {
        await mount();
        await snapshot(orphan());
        expect(sent().filter(m => m.topic === 'app')).toEqual([]);
        expect(sent().find(m => m.topic === 'apps')).toBeTruthy();
        expect(host.querySelector('h1')!.textContent).toBe('Apps');
        const dialog = host.querySelector('dialog.modal')!;
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.querySelector('h2')!.textContent).toBe('Leftovers of old_presence');
    });

    it('reports a topic error', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'boom' });
        expect(text()).toContain("Couldn't load app");
        expect(text()).toContain('boom');
    });
});

const modal = () => host.querySelector('dialog.modal') as HTMLElement;
const confirmDialog = () => host.querySelector('dialog.confirm') as HTMLElement;

describe('leftovers modal', () => {
    const open = async (tab?: string, l = orphan()) => { await mount(tab); await snapshot(l) };

    it('lists the four groups: operating dir, entities still in HA, stored keys, pending destroyers', async () => {
        await open('leftovers');
        expect([...modal().querySelectorAll('[data-section] h3')].map(h => h.firstChild!.textContent!.trim()))
            .toEqual(['Operating directory', 'Entities still in Home Assistant', 'Stored keys', 'Pending destroyers']);
        expect(modal().textContent).toContain('.typedaemon/app_environments/old_presence');
        expect(modal().textContent).toContain('48.0 KB');
        expect([...modal().querySelectorAll('.entity-row')].map(r => r.querySelector('.entity-eid')!.textContent).sort())
            .toEqual(['binary_sensor.old_presence_away', 'binary_sensor.old_presence_home']);
        expect(modal().querySelector('.skey-key')!.textContent).toBe('last_seen');
        expect(modal().textContent).toContain('HAEntities');
        expect(modal().textContent).toContain('home_assistant');
    });

    it('hides internal storage keys until asked', async () => {
        await open('leftovers');
        expect([...modal().querySelectorAll('.skey-key')].map(k => k.textContent)).toEqual(['last_seen']);
        click(button(/Show internal keys \(1\)/));
        expect([...modal().querySelectorAll('.skey-key')].map(k => k.textContent)).toEqual(['_destroyers', 'last_seen']);
    });

    it('shows empty groups as such', async () => {
        await open('leftovers', orphan(leftovers({ storage: [], entities: [], destroyers: [] })));
        expect(modal().textContent).toContain('No entities');
        expect(modal().textContent).toContain('No stored keys');
        expect(modal().textContent).toContain('No pending destroyers');
    });

    it('has no confirmation up until Clean up… is pressed', async () => {
        await open('leftovers');
        expect(confirmDialog().hasAttribute('open')).toBe(false);
        click(button(/Clean up/, modal()));
        expect(confirmDialog().hasAttribute('open')).toBe(true);
    });

    it.each([
        ['the X', () => click(modal().querySelector('[aria-label="Close"]')!)],
        ['Close', () => click(button(/^Close$/, modal()))],
        ['Esc', () => act(() => { modal().dispatchEvent(new Event('cancel', { cancelable: true })) })],
    ])('closing with %s goes back to #/apps', async (_n, close) => {
        const { app } = await import('../app');
        await open('leftovers');
        app.route.navigate('/apps/old_presence/leftovers');
        close();
        expect(app.route.path).toBe('/apps');
    });
});

describe('orphan cleanup', () => {
    const openConfirm = async () => {
        await mount('cleanup');
        await snapshot(orphan());
        return confirmDialog();
    };

    it('the cleanup route opens the confirm over the leftovers modal, with exactly what will and will not happen; cancel sends nothing', async () => {
        const dialog = await openConfirm();
        expect(modal().hasAttribute('open')).toBe(true);
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.querySelector('h2')!.textContent).toBe('Clean up orphan old_presence?');
        const [will, wont] = [...dialog.querySelectorAll('.confirm-grid > div')].map(d => d.textContent);
        expect(will).toBe('Run 1 destroyer (HAEntities): remove 2 entities from Home Assistant (binary_sensor.old_presence_away +1), then delete its operating directory (.typedaemon/app_environments/old_presence: 48.0 KB in 7 files) and its 2 stored keys.');
        expect(wont).toMatch(/source/);
        expect(wont).toMatch(/config/);
        expect(wont).toMatch(/auto_clean/);
        expect(dialog.textContent).toContain("This can't be undone.");
        click(button(/Cancel/, dialog));
        expect(dialog.hasAttribute('open')).toBe(false);
        expect(calls()).toEqual([]);
    });

    it('confirming calls orphan.cleanup and shows progress until the server answers', async () => {
        const dialog = await openConfirm();
        click(button(/Clean up/, dialog));
        expect(calls()).toEqual([expect.objectContaining({ action: 'orphan.cleanup', params: { id: 'old_presence' } })]);
        expect(dialog.hasAttribute('open')).toBe(false);
        expect(button(/Cleaning up/, modal()).disabled).toBe(true);
    });

    it('a finished cleanup goes back to #/apps without ever loading the app page', async () => {
        const { app } = await import('../app');
        app.route.navigate('/apps/old_presence/cleanup');
        const dialog = await openConfirm();
        click(button(/Clean up/, dialog));
        await serverSend({ type: 'result', id: calls()[0].id, ok: true });
        await delta({ id: 'old_presence' });
        expect(app.route.path).toBe('/apps');
        expect(sent().filter(m => m.topic === 'app')).toEqual([]);
        expect(text()).not.toContain("Couldn't load app");
    });

    it('shows the failure and keeps the modal and leftovers when cleanup fails', async () => {
        const { app } = await import('../app');
        app.route.navigate('/apps/old_presence/cleanup');
        const dialog = await openConfirm();
        click(button(/Clean up/, dialog));
        await serverSend({ type: 'result', id: calls()[0].id, ok: false, message: "Destroyer 'HAEntities' failed: HA down" });
        const alert = modal().querySelector('[role="alert"]')!.textContent!;
        expect(alert).toContain('Cleanup failed; nothing more was changed.');
        expect(alert).toContain('HA down');
        expect(modal().hasAttribute('open')).toBe(true);
        expect(app.route.path).toBe('/apps/old_presence/cleanup');
        expect(button(/Clean up/, modal()).disabled).toBe(false);
    });

    it('describes a cleanup without destroyers as only deleting files', async () => {
        await mount('leftovers');
        await snapshot(orphan(leftovers({ destroyers: [], entities: [] })));
        click(button(/Clean up/, modal()));
        const will = host.querySelector('.confirm-grid > div')!.textContent!;
        expect(will).toMatch(/^Delete its operating directory/);
        expect(will).not.toMatch(/destroyer/);
    });
});
