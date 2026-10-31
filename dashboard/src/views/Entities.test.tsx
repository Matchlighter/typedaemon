// @vitest-environment happy-dom
import type { GlobalEntityRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';
import { stubLayout } from '../test/layout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();
stubLayout({ viewport: 400, row: 56 });

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

const row = (app: string, id: string, over: Partial<GlobalEntityRow> = {}): GlobalEntityRow => ({
    key: `${app}/ha:${id}`, entityKey: `ha:${id}`, app, plugin: 'ha', domain: id.split('.')[0], entityId: id, state: '1',
    linked: true, autoClean: false, persistState: false, ...over,
});
const unlinked = (app: string, id: string, over: Partial<GlobalEntityRow> = {}) => row(app, id, { linked: false, state: undefined, autoClean: true, ...over });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (rows: GlobalEntityRow[]) => serverSend({ type: 'snapshot', id: 1, data: { rows } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const rowEls = () => [...host.querySelectorAll('.entity-row')];
const ids = () => rowEls().map(r => r.querySelector('.entity-eid')!.textContent);
const button = (re: RegExp, within: ParentNode = host) => [...within.querySelectorAll('button')].find(b => re.test(b.textContent!)) as HTMLButtonElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click() });
const select = (label: string) => host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const choose = (label: string, value: string) => act(() => {
    const el = select(label);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
});
const search = (text: string) => act(() => {
    const el = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

async function mount() {
    const { Entities } = await import('./Entities');
    await act(async () => { root.render(<Entities />) });
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

const sample = () => [
    row('lights', 'light.hall'), unlinked('lights', 'sensor.old'),
    row('garden', 'sensor.soil', { name: 'Soil moisture' }), unlinked('gone', 'sensor.left', { orphan: true }),
];

describe('Entities view', () => {
    it('subscribes to the entities topic and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'entities' });
        expect(host.textContent).toContain('Syncing');
    });

    it('lists entities of all apps, each with its owning app (orphans marked), sorted by id', async () => {
        await mount();
        await snapshot(sample());
        expect(ids()).toEqual(['light.hall', 'sensor.left', 'sensor.old', 'sensor.soil']);
        const text = rowEls().map(r => r.textContent);
        expect(text[0]).toContain('lights');
        expect(text[1]).toContain('gone (orphan)');
        expect(text[3]).toContain('Soil moisture');
    });

    it('has column headers, an orphan-colored owner and a count + orphan-cleanup footer', async () => {
        await mount();
        await snapshot(sample());
        expect([...host.querySelectorAll('th')].map(h => h.textContent)).toEqual(['Entity', 'Owner', 'State', 'Link', '']);
        expect(rowEls()[1].querySelector('.entity-owner')!.classList.contains('entity-owner-orphan')).toBe(true);
        expect(host.querySelector('.ents-foot')!.textContent).toBe('Showing 4 of 4 · 1 unlinked belong to orphan gone — cleaning up the orphan removes them all at once.');
        search('soil');
        expect(host.querySelector('.ents-foot')!.textContent).toMatch(/^Showing 1 of 4/);
    });

    it('with a selected key: highlights that row and opens its detail panel beside the list; none otherwise', async () => {
        const { Entities } = await import('./Entities');
        await mount();
        await snapshot(sample());
        expect(host.querySelector('.entity-selected')).toBeNull();
        expect(host.querySelector('.entp')).toBeNull();
        await act(async () => { root.render(<Entities selected="garden/ha:sensor.soil" />) });
        expect(rowEls()).toHaveLength(4);
        expect(host.querySelector('.entity-selected')!.textContent).toContain('sensor.soil');
        expect(host.querySelector('.entp')).toBeTruthy();
        expect(sent().some(m => m.type === 'subscribe' && m.topic === 'entity' && m.params.id === 'garden/ha:sensor.soil')).toBe(true);
    });

    it('links the owner to its app page (orphans too: that is where their cleanup is)', async () => {
        await mount();
        await snapshot(sample());
        const hrefs = rowEls().map(r => r.querySelector('a.entity-owner')?.getAttribute('href'));
        expect(hrefs).toEqual(['#/apps/lights', '#/apps/gone', '#/apps/lights', '#/apps/garden']);
    });

    it('combines the app, domain, link status and text filters, with counts that follow the other filters', async () => {
        await mount();
        await snapshot(sample());
        const seg = host.querySelector('.seg')!;
        expect(seg.textContent).toContain('All4');
        expect(seg.textContent).toContain('Linked2');
        expect(seg.textContent).toContain('Unlinked2');

        choose('Filter by domain', 'sensor');
        expect(ids()).toEqual(['sensor.left', 'sensor.old', 'sensor.soil']);
        click(button(/Unlinked/, seg));
        expect(ids()).toEqual(['sensor.left', 'sensor.old']);
        choose('Filter by app', 'lights');
        expect(ids()).toEqual(['sensor.old']);
        expect(seg.textContent).toContain('All1');
        expect(select('Filter by app').textContent).toContain('gone (orphan)');
        expect(seg.querySelector('.cnt-w')!.textContent).toBe('1');
        click(button(/All/, seg));
        search('OLD');
        expect(ids()).toEqual(['sensor.old']);
        search('soil');
        expect(ids()).toEqual([]);
        expect(host.textContent).toContain('No matching entities');
    });

    it('answers who owns an entity: search by id', async () => {
        await mount();
        await snapshot(sample());
        search('sensor.soil');
        expect(rowEls()).toHaveLength(1);
        expect(rowEls()[0].querySelector('a.entity-owner')!.textContent).toBe('garden');
    });

    it('updates live across apps and keeps the filters when rows come and go', async () => {
        await mount();
        await snapshot(sample());
        choose('Filter by app', 'garden');
        await delta({ upsert: [row('garden', 'sensor.soil', { state: '9' }), row('lights', 'light.hall', { state: 'on' })] });
        expect(rowEls()[0].textContent).toContain('9');
        await delta({ remove: ['garden/ha:sensor.soil'] });
        expect(rowEls()).toHaveLength(0);
        await delta({ upsert: [row('garden', 'sensor.new')] });
        expect(ids()).toEqual(['sensor.new']);
        expect(select('Filter by app').value).toBe('garden');
    });

    it('offers Delete from HA on unlinked rows of configured apps only (orphans are cleaned up on their page)', async () => {
        await mount();
        await snapshot(sample());
        expect(rowEls().map(r => /Delete from HA/.test(r.textContent!))).toEqual([false, false, true, false]);
    });

    it('confirms, then deletes through entity.delete with the app and its own key', async () => {
        await mount();
        await snapshot(sample());
        click(button(/Delete from HA/, rowEls()[2]));
        const dialog = host.querySelector('dialog')!;
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.textContent).toContain('sensor.old');
        click(button(/Delete from HA/, dialog));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'entity.delete', params: { app: 'lights', key: 'ha:sensor.old' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        await delta({ remove: ['lights/ha:sensor.old'] });
        expect(ids()).not.toContain('sensor.old');
        expect(dialog.hasAttribute('open')).toBe(false);
    });

    it('shows the server error when deleting fails', async () => {
        await mount();
        await snapshot(sample());
        click(button(/Delete from HA/, rowEls()[2]));
        click(button(/Delete from HA/, host.querySelector('dialog')!));
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: false, message: 'mqtt down' });
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('mqtt down');
    });

    it('renders only the rows in view however many entities there are', async () => {
        await mount();
        await snapshot(Array.from({ length: 5000 }, (_, i) => row('a', `sensor.s${String(i).padStart(5, '0')}`)));
        expect(rowEls().length).toBeGreaterThan(5);
        expect(rowEls().length).toBeLessThan(60);
        expect(host.querySelector('.seg')!.textContent).toContain('All5000');
    });

    it('shows an empty state', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No entities');
    });

    it('dims rows of a down HA plugin with a note, and recovers on reconnect', async () => {
        await mount();
        await snapshot(sample());
        const plug = (connection: string) => ({ id: 'ha', type: 'home_assistant', state: 'started', since: 0, connection });
        serverSend({ type: 'snapshot', id: 2, data: { plugins: [plug('connected')] } });
        expect(host.querySelectorAll('.entity-stale').length).toBe(0);
        expect(host.textContent).not.toContain('link down');

        serverSend({ type: 'snapshot', id: 2, data: { plugins: [plug('reconnecting')] } });
        expect(host.querySelectorAll('.entity-stale').length).toBe(rowEls().length);
        expect(host.textContent).toContain('Home Assistant link down (ha)');

        serverSend({ type: 'snapshot', id: 2, data: { plugins: [plug('connected')] } });
        expect(host.querySelectorAll('.entity-stale').length).toBe(0);
        expect(host.textContent).not.toContain('link down');
    });
});
