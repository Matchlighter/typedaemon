// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandPalette, isPaletteHotkey, openPalette } from './CommandPalette';
import { stubDialog } from '../test/dialog';
import { matchRange, type PaletteProvider } from './palette_model';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const runs: string[] = [];
const prov = (id: string, title: string, labels: string[]): PaletteProvider => ({
    id, title,
    search: q => labels.filter(l => matchRange(l, q)).map(l => ({ id: `${id}:${l}`, label: l, sublabel: 'sub', run: () => { runs.push(l); } })),
});
const providers = [prov('e', 'Entities', ['light.kitchen', 'light.hall']), prov('a', 'Actions', ['Restart lights'])];
beforeEach(() => { runs.length = 0; });

const render = () => act(() => root.render(<CommandPalette providers={providers} />));
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document) =>
    act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
const input = () => host.querySelector<HTMLInputElement>('input')!;
const type = (v: string) => act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input(), v);
    input().dispatchEvent(new Event('input', { bubbles: true }));
});
const active = () => host.querySelector('[role=option][aria-selected=true]')?.textContent;

describe('isPaletteHotkey', () => {
    it('accepts ctrl+k and cmd+k only', () => {
        expect(isPaletteHotkey({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true);
        expect(isPaletteHotkey({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true);
        expect(isPaletteHotkey({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false);
        expect(isPaletteHotkey({ key: 'j', ctrlKey: true, metaKey: false })).toBe(false);
    });
});

describe('CommandPalette onOpenChange', () => {
    it('reports open and close', () => {
        const seen: boolean[] = [];
        act(() => root.render(<CommandPalette providers={providers} onOpenChange={o => seen.push(o)} />));
        key('k', { ctrlKey: true });
        key('k', { ctrlKey: true });
        expect(seen).toEqual([true, false]);
    });
});

describe('CommandPalette', () => {
    it('is closed until Ctrl+K, then shows grouped results and focuses the input', () => {
        render();
        expect(host.querySelector('dialog[open]')).toBeNull();
        key('k', { ctrlKey: true });
        expect(host.querySelector('dialog[open]')).not.toBeNull();
        expect(document.activeElement).toBe(input());
        expect([...host.querySelectorAll('.pal-group-lbl')].map(e => e.textContent)).toEqual(['Entities', 'Actions']);
        expect(host.querySelectorAll('[role=option]').length).toBe(3);
    });

    it('opens on Cmd+K and prevents the browser default', () => {
        render();
        const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
        act(() => { document.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(true);
        expect(host.querySelector('dialog[open]')).not.toBeNull();
    });

    it('closes on Esc', () => {
        render(); key('k', { ctrlKey: true });
        act(() => { host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); });
        expect(host.querySelector('dialog[open]')).toBeNull();
    });

    it('filters on typing and highlights the matched substring', () => {
        render(); key('k', { ctrlKey: true });
        type('kit');
        expect(host.querySelectorAll('[role=option]').length).toBe(1);
        expect(host.querySelector('[role=option] mark')!.textContent).toBe('kit');
    });

    it('shows an empty message when nothing matches', () => {
        render(); key('k', { ctrlKey: true }); type('zzz');
        expect(host.textContent).toContain('No results');
    });

    it('arrows move across groups, wrapping; Enter runs the active result and closes', () => {
        render(); key('k', { ctrlKey: true });
        expect(active()).toContain('light.kitchen');
        key('ArrowDown', {}, input()); key('ArrowDown', {}, input());
        expect(active()).toContain('Restart lights');
        key('ArrowDown', {}, input());
        expect(active()).toContain('light.kitchen');
        key('ArrowUp', {}, input());
        expect(active()).toContain('Restart lights');
        key('Enter', {}, input());
        expect(runs).toEqual(['Restart lights']);
        expect(host.querySelector('dialog[open]')).toBeNull();
    });

    it('resets the active row when the query changes', () => {
        render(); key('k', { ctrlKey: true });
        key('ArrowDown', {}, input());
        type('light');
        expect(active()).toContain('light.kitchen');
    });

    it('clicking a result runs it', () => {
        render(); key('k', { ctrlKey: true });
        act(() => { host.querySelectorAll<HTMLElement>('[role=option]')[1].click(); });
        expect(runs).toEqual(['light.hall']);
        expect(host.querySelector('dialog[open]')).toBeNull();
    });

    it('clicking the scrim closes; reopening starts with an empty query', () => {
        render(); key('k', { ctrlKey: true }); type('kit');
        act(() => { host.querySelector<HTMLElement>('.pal')!.click(); });
        expect(host.querySelector('dialog[open]')).toBeNull();
        key('k', { ctrlKey: true });
        expect(input().value).toBe('');
    });

    it('Ctrl+K again toggles it closed', () => {
        render(); key('k', { ctrlKey: true }); key('k', { ctrlKey: true }, input());
        expect(host.querySelector('dialog[open]')).toBeNull();
    });

    it('stops listening after unmount', () => {
        render(); act(() => root.render(<div />));
        key('k', { ctrlKey: true });
        expect(host.querySelector('dialog[open]')).toBeNull();
    });
});

describe("openPalette", () => {
    it("opens a mounted palette (header search button)", () => {
        const seen: boolean[] = [];
        act(() => root.render(<CommandPalette providers={providers} onOpenChange={o => seen.push(o)} />));
        act(() => openPalette());
        act(() => openPalette());
        expect(seen).toEqual([true]);
    });
});
