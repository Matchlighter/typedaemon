// @vitest-environment happy-dom
import type { ServerMessage, StorageRow } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

const sock = vi.hoisted(() => ({ current: null as any, connection: null as any }));
vi.mock('../app', () => ({ app: { get connection() { return sock.connection } } }));

const PATH = '.typedaemon/app_environments/lights/.persistence.jkv';
const row = (key: string, over: Partial<StorageRow> = {}): StorageRow => ({ key, value: 1, size: 1, writtenAt: Date.now() - 60_000, internal: false, ...over });
const internal = (key: string) => row(key, { internal: true });

let host: HTMLElement, root: Root;
const serverSend = (m: ServerMessage) => act(() => { sock.current.onmessage({ data: JSON.stringify(m) }) });
const sent = () => sock.current.sent as any[];
const snapshot = (rows: StorageRow[]) => serverSend({ type: 'snapshot', id: 1, data: { path: PATH, rows } });
const delta = (d: object) => serverSend({ type: 'delta', id: 1, data: d });
const rowEls = () => [...host.querySelectorAll('.skey-row')];
const keys = () => rowEls().map(r => r.querySelector('.skey-key')!.textContent);
const button = (re: RegExp, within: ParentNode = host) => [...within.querySelectorAll('button')].find(b => re.test(b.textContent! + (b.getAttribute('aria-label') ?? ''))) as HTMLButtonElement;
const internalBox = () => host.querySelector('input[type=checkbox]') as HTMLInputElement | null;
const click = (el: Element) => act(() => { (el as HTMLElement).click() });

async function mount() {
    const { AppStorageTab } = await import('./AppStorageTab');
    await act(async () => { root.render(<AppStorageTab appId="lights" />) });
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

describe('App storage tab', () => {
    it('subscribes to the appStorage topic for its app and shows syncing first', async () => {
        await mount();
        expect(sent()[0]).toMatchObject({ type: 'subscribe', topic: 'appStorage', params: { id: 'lights' } });
        expect(host.textContent).toContain('Syncing');
    });

    it('shows the store path, the keys with JSON values, and the store-only caveat', async () => {
        await mount();
        await snapshot([row('zeta', { value: 'z' }), row('alpha', { value: { a: 1 } })]);
        expect(host.querySelector('.stor-path')!.textContent).toBe(PATH);
        expect(host.querySelector('.stor-meta')!.textContent).toContain('· live');
        expect([...host.querySelectorAll('.skey-head span')].map(e => e.textContent)).toEqual(['Key', 'Value', 'Size', 'Last write', '']);
        expect(keys()).toEqual(['alpha', 'zeta']);
        expect(rowEls()[0].querySelector('.skey-preview')!.textContent).toBe('{"a":1}');
        expect(host.querySelector('.banner')!.textContent).toMatch(/removes it from the store only.*running app keeps/i);
    });

    it('hides internal keys behind "Show internal keys (N)"', async () => {
        await mount();
        await snapshot([row('mine'), internal('_destroyers'), internal('ha[x].entities.auto_clean')]);
        expect(keys()).toEqual(['mine']);
        click(internalBox()!);
        expect(keys()).toEqual(['_destroyers', 'ha[x].entities.auto_clean', 'mine']);
        expect(host.querySelectorAll('.skey-internal')).toHaveLength(2);
        click(internalBox()!);
        expect(keys()).toEqual(['mine']);
    });

    it('filters keys by case-insensitive substring and says when nothing matches', async () => {
        await mount();
        await snapshot([row('Scene_history'), row('presence'), internal('_scene_cache')]);
        const input = host.querySelector('input[aria-label="Filter keys"]') as HTMLInputElement;
        const type = (v: string) => act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        type('SCENE');
        expect(keys()).toEqual(['Scene_history']);
        click(internalBox()!);
        expect(keys()).toEqual(['_scene_cache', 'Scene_history']);
        type('zzz');
        expect(host.textContent).toContain('No matching keys');
    });

    it('previews scalars and flat containers on one line; only nested values get a tree, and each row can copy', async () => {
        await mount();
        await snapshot([
            row('s', { value: 'evening' }),
            row('flat', { value: { a: 'home', b: 'away' } }),
            row('long', { value: Array.from({ length: 48 }, () => 'evening') }),
            row('nested', { value: { attrs: { icon: 'x' } } }),
        ]);
        const byKey = (k: string) => rowEls().find(r => r.getAttribute('data-row-key') === k)!;
        expect(byKey('s').querySelector('.skey-preview')!.textContent).toBe('"evening"');
        expect(byKey('flat').querySelector('.skey-preview')!.textContent).toBe('{"a":"home","b":"away"}');
        expect(byKey('long').querySelector('.skey-preview')!.textContent).toMatch(/^\["evening".*, … \d+ more\]$/);
        expect(byKey('nested').querySelector('.skey-preview')).toBeNull();
        expect(byKey('nested').querySelector('.json-viewer')).toBeTruthy();
        expect(byKey('nested').querySelector('.json-copy')).toBeNull();
        expect(button(/Copy value of nested/, byKey('nested'))).toBeTruthy();
        expect(button(/Copy value of s$/, byKey('s'))).toBeTruthy();
    });

    it('offers no internal toggle when there are none', async () => {
        await mount();
        await snapshot([row('mine')]);
        expect(internalBox()).toBeNull();
    });

    it('applies writes live and flashes the changed row only', async () => {
        await mount();
        await snapshot([row('a', { value: 1 }), row('b', { value: 1 })]);
        expect(host.querySelector('.flash')).toBeNull();
        await delta({ upsert: [row('b', { value: 2, writtenAt: Date.now() })] });
        expect(rowEls()[1].textContent).toContain('2');
        expect(rowEls()[1].classList.contains('flash')).toBe(true);
        expect(rowEls()[0].classList.contains('flash')).toBe(false);
        await delta({ upsert: [row('c')] });
        expect(keys()).toEqual(['a', 'b', 'c']);
    });

    it('keeps open JSON nodes across deltas and across an app restart (rows dropped and recreated)', async () => {
        await mount();
        const val = (n: number) => ({ cfg: { n }, other: 1 });
        await snapshot([row('open_me', { value: val(1) })]);
        click(button(/Expand open_me#\$\.cfg|Expand .*\$\.cfg/));
        expect(host.textContent).toContain('"n"');
        await delta({ upsert: [row('open_me', { value: val(2), writtenAt: Date.now() })] });
        expect(host.textContent).toContain('"n"');
        await delta({ remove: ['open_me'] });
        expect(rowEls()).toHaveLength(0);
        await delta({ upsert: [row('open_me', { value: val(3) })] });
        expect(host.textContent).toContain('"n"');
    });

    it('does not mix up open state of different keys', async () => {
        await mount();
        await snapshot([row('k1', { value: { cfg: { n: 1 } } }), row('k2', { value: { cfg: { n: 1 } } })]);
        click(button(/Expand/, rowEls()[1]));
        expect(rowEls()[1].textContent).toContain('"n"');
        expect(rowEls()[0].textContent).not.toContain('"n"');
    });

    it('loads large values lazily through storage.value on expand', async () => {
        await mount();
        await snapshot([row('big', { value: undefined, size: 90_000, lazy: { kind: 'array', count: 3, size: 90_000 } })]);
        expect(rowEls()[0].textContent).toContain('3 items');
        expect(sent().filter(m => m.type === 'call')).toEqual([]);
        click(button(/Expand/, rowEls()[0]));
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'storage.value', params: { app: 'lights', key: 'big' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true, data: [101, 102, 103] });
        expect(rowEls()[0].textContent).toContain('102');
    });

    it('loads a lazy value that was left open (state restored from an earlier visit) without a click', async () => {
        const { sharedJsonViewState, scopedPath } = await import('../stores/json_view_state');
        sharedJsonViewState().toggle(scopedPath('storage/lights/was_open', '$'), true);
        await mount();
        await snapshot([row('was_open', { value: undefined, size: 90_000, lazy: { kind: 'array', count: 1, size: 90_000 } })]);
        expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'storage.value', params: { app: 'lights', key: 'was_open' } });
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true, data: [333] });
        expect(rowEls()[0].textContent).toContain('333');
    });

    it('refetches an already loaded lazy value when the key is written again', async () => {
        await mount();
        const lazyRow = (size: number) => row('big2', { value: undefined, size, lazy: { kind: 'array', count: 1, size }, writtenAt: Date.now() + size });
        await snapshot([lazyRow(40_000)]);
        click(button(/Expand/, rowEls()[0]));
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true, data: [111] });
        const calls = () => sent().filter(m => m.action === 'storage.value').length;
        expect(calls()).toBe(1);
        await delta({ upsert: [lazyRow(40_001)] });
        expect(calls()).toBe(2);
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true, data: [222] });
        expect(rowEls()[0].textContent).toContain('222');
    });

    it('does not refetch a loaded lazy value when an unchanged snapshot is resent (reconnect)', async () => {
        await mount();
        const lazyRow = () => row('big3', { value: undefined, size: 40_000, lazy: { kind: 'array', count: 1, size: 40_000 }, writtenAt: 1000 });
        await snapshot([lazyRow()]);
        click(button(/Expand/, rowEls()[0]));
        await serverSend({ type: 'result', id: sent().at(-1).id, ok: true, data: [111] });
        const calls = () => sent().filter(m => m.action === 'storage.value').length;
        expect(calls()).toBe(1);
        await snapshot([lazyRow()]);
        expect(calls()).toBe(1);
    });

    describe('delete', () => {
        it('confirms first, stating the store-only caveat; cancel sends nothing', async () => {
            await mount();
            await snapshot([row('counter')]);
            click(button(/Delete counter/, rowEls()[0]));
            const dialog = host.querySelector('dialog')!;
            expect(dialog.hasAttribute('open')).toBe(true);
            expect(dialog.textContent).toContain('counter');
            expect(dialog.textContent).toMatch(/Will/);
            expect(dialog.textContent).toMatch(/Won't/);
            expect(dialog.textContent).toMatch(/keeps .*memory.*until it writes (the key )?again or restarts/i);
            click(button(/Cancel/, dialog));
            expect(dialog.hasAttribute('open')).toBe(false);
            expect(sent().filter(m => m.type === 'call')).toEqual([]);
        });

        it('confirming calls storage.delete for that key and the row goes when the server says so', async () => {
            await mount();
            await snapshot([row('counter'), row('other')]);
            click(button(/Delete counter/, rowEls()[0]));
            const dialog = host.querySelector('dialog')!;
            click(button(/Delete key/, dialog));
            expect(sent().at(-1)).toMatchObject({ type: 'call', action: 'storage.delete', params: { app: 'lights', key: 'counter' } });
            await serverSend({ type: 'result', id: sent().at(-1).id, ok: true });
            expect(dialog.hasAttribute('open')).toBe(false);
            await delta({ remove: ['counter'] });
            expect(keys()).toEqual(['other']);
        });

        it('shows the server error when deletion fails and keeps the row', async () => {
            await mount();
            await snapshot([row('counter')]);
            click(button(/Delete counter/, rowEls()[0]));
            click(button(/Delete key/, host.querySelector('dialog')!));
            await serverSend({ type: 'result', id: sent().at(-1).id, ok: false, message: 'disk full' });
            expect(host.querySelector('[role="alert"]')!.textContent).toContain('disk full');
            expect(keys()).toEqual(['counter']);
        });

        it('internal rows can be deleted too', async () => {
            await mount();
            await snapshot([internal('_destroyers')]);
            click(internalBox()!);
            expect(button(/Delete _destroyers/, rowEls()[0])).toBeTruthy();
        });
    });

    it('shows an empty state, and a different one when only internal keys exist', async () => {
        await mount();
        await snapshot([]);
        expect(host.textContent).toContain('No stored keys');
        await delta({ upsert: [internal('_destroyers')] });
        expect(host.textContent).toContain('No stored keys');
        expect(internalBox()!.parentElement!.textContent).toContain('Show internal keys (1)');
    });

    it('shows the topic error', async () => {
        await mount();
        await serverSend({ type: 'error', id: 1, message: 'Unknown app: lights' });
        expect(host.textContent).toContain("Couldn't load storage");
        expect(host.textContent).toContain('Unknown app: lights');
    });
});
