// @vitest-environment happy-dom
import type { EntityRow, ServerMessage } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection }, system: { data: { haBaseUrl: 'http://ha.local:8123' } } } }));

const row = (key: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key: `ha:${key}`, plugin: 'ha', domain: 'sensor', entityId: `sensor.${key}`, state: '1', linked: true, autoClean: false, persistState: false, ...over });
const unlinked = (key: string) => row(key, { linked: false, autoClean: true, state: undefined });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (rows: EntityRow[]) => serverSend({ type: 'snapshot', id: 1, data: { rows } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const rowEls = () => [...host.querySelectorAll('tbody .entity-row')];
const button = (re: RegExp, within: ParentNode = host) => [...within.querySelectorAll('button')].find(b => re.test(b.textContent!)) as HTMLButtonElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click() });

async function mount() {
    const { AppEntitiesTab } = await import('./AppEntitiesTab');
    await act(async () => { root.render(<AppEntitiesTab appId="lights" />) });
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

describe('App entities tab', () => {
    it('subscribes to the appEntities topic for its app and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'appEntities', params: { id: 'lights' } });
        expect(host.textContent).toContain('Syncing');
    });

    it('lists entity rows with state, flags and link status', async () => {
        await mount();
        await snapshot([row('temp', { state: '21.4', persistState: true, autoClean: true, name: 'Temperature' }), unlinked('old')]);
        expect(rowEls()).toHaveLength(2);
        const [old, temp] = rowEls();
        expect(temp.textContent).toContain('sensor.temp');
        expect(temp.textContent).toContain('21.4');
        expect(temp.textContent).toContain('persist_state');
        expect(temp.textContent).toContain('Temperature');
        expect(old.textContent).toContain('unlinked');
        expect(old.textContent).toContain('unavailable');
    });

    it('shows All/Linked/Unlinked with counts and filters', async () => {
        await mount();
        await snapshot([row('a'), row('b'), unlinked('c')]);
        const seg = host.querySelector('.seg')!;
        expect(seg.textContent).toContain('All3');
        expect(seg.textContent).toContain('Linked2');
        expect(seg.textContent).toContain('Unlinked1');
        click(button(/Unlinked/, seg));
        expect(rowEls().map(r => r.textContent)).toEqual([expect.stringContaining('sensor.c')]);
    });

    it('lays entities out as a table with domain, flags and link columns, an HA link and a footer', async () => {
        await mount();
        await snapshot([row('a', { autoClean: true }), unlinked('b')]);
        expect([...host.querySelectorAll('thead th')].map(t => t.textContent)).toEqual(['Entity', 'Domain', 'State', 'Flags', 'Link', '']);
        expect(rowEls()[0].querySelectorAll('td')[1].textContent).toBe('sensor');
        expect(rowEls()[0].querySelector('a[aria-label^="Open sensor.a in Home"]')!.getAttribute('href')).toContain('http://ha.local:8123');
        expect(host.querySelector('.ents-foot')!.textContent).toBe('Showing 2 of 2 · state updates live');
    });

    it('filters by text and reports the shown count', async () => {
        await mount();
        await snapshot([row('temp'), row('humid'), row('door')]);
        const input = host.querySelector('input[aria-label="Filter entities"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'tem');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(rowEls()).toHaveLength(1);
        expect(host.querySelector('.ents-foot')!.textContent).toBe('Showing 1 of 3 · state updates live');
    });

    it('explains unlinked entities in the footer of the Unlinked segment', async () => {
        await mount();
        await snapshot([row('a'), unlinked('c')]);
        click(button(/Unlinked/, host.querySelector('.seg')!));
        expect(host.querySelector('.ents-foot')!.textContent).toMatch(/no running app registers it/);
    });

    it('updates entity states live', async () => {
        await mount();
        await snapshot([row('a', { state: 'off' })]);
        await delta({ upsert: [row('a', { state: 'on' })] });
        expect(rowEls()[0].textContent).toContain('on');
        expect(rowEls()[0].textContent).not.toContain('off');
    });

    it('keeps the chosen filter when an app restart drops and recreates the rows', async () => {
        await mount();
        await snapshot([row('a'), unlinked('c')]);
        click(button(/Unlinked/, host.querySelector('.seg')!));
        await delta({ remove: ['ha:a', 'ha:c'] });
        expect(rowEls()).toHaveLength(0);
        await delta({ upsert: [row('a'), unlinked('c')] });
        expect(rowEls()).toHaveLength(1);
        expect(host.querySelector('.seg button[aria-pressed="true"]')!.textContent).toContain('Unlinked');
    });

    it('offers Delete from HA only on unlinked rows', async () => {
        await mount();
        await snapshot([row('a'), unlinked('c')]);
        expect(rowEls().filter(r => /Delete from HA/.test(r.textContent!))).toHaveLength(1);
        expect(rowEls()[1].textContent).toContain('sensor.c');
    });

    it('confirms before deleting, saying what will and will not happen; cancel sends nothing', async () => {
        await mount();
        await snapshot([unlinked('c')]);
        click(button(/Delete from HA/, rowEls()[0]));
        const dialog = host.querySelector('dialog')!;
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.textContent).toContain('sensor.c');
        expect(dialog.textContent).toMatch(/Will/);
        expect(dialog.textContent).toMatch(/auto-clean registry/);
        expect(dialog.textContent).toMatch(/Won't/);
        click(button(/Cancel/, dialog));
        expect(dialog.hasAttribute('open')).toBe(false);
        expect(sent().filter(m => m.type === 'call')).toEqual([]);
    });

    it('confirming calls entity.delete for that row and closes the dialog', async () => {
        await mount();
        await snapshot([unlinked('c')]);
        click(button(/Delete from HA/, rowEls()[0]));
        const dialog = host.querySelector('dialog')!;
        click(button(/Delete from HA/, dialog));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'entity.delete', params: { app: 'lights', key: 'ha:c' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
        expect(dialog.hasAttribute('open')).toBe(false);
        await delta({ remove: ['ha:c'] });
        expect(rowEls()).toHaveLength(0);
    });

    it('shows the server error when deletion fails and keeps the row', async () => {
        await mount();
        await snapshot([unlinked('c')]);
        click(button(/Delete from HA/, rowEls()[0]));
        click(button(/Delete from HA/, host.querySelector('dialog')!));
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: false, message: 'mqtt down' });
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('mqtt down');
        expect(rowEls()).toHaveLength(1);
    });

    it('shows an empty state', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No entities');
    });

    it('shows the topic error', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' });
        expect(host.textContent).toContain("Couldn't load entities");
        expect(host.textContent).toContain('Unknown app: lights');
    });
});
