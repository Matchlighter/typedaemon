// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeyRow, type StorageKeyRowProps } from './StorageKeyRow';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 19, 18, 0, 0).getTime();
const base: StorageKeyRowProps = { storageKey: 'scenes', value: { a: 1 }, writtenAt: NOW - 9 * 60_000 };

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const render = (p: Partial<StorageKeyRowProps> = {}) => act(() => root.render(<StorageKeyRow {...base} {...p} />));

beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

describe('StorageKeyRow', () => {
    it('key, json value, size, relative last write', () => {
        render({ value: { a: 1 }, size: 1946 });
        expect(host.querySelector('.skey-key')!.textContent).toBe('scenes');
        expect(host.querySelector('.json-key')!.textContent).toBe('"a"');
        expect(host.querySelector('.skey-size')!.textContent).toBe('1.9 KB');
        expect(host.querySelector('time')).toBeTruthy();
    });

    it('size defaults to serialized byte size', () => {
        render({ value: 'hello' });
        expect(host.querySelector('.skey-size')!.textContent).toBe('7 B');
    });

    it('internal keys are tagged and styled (what to show is the list owner\'s call)', () => {
        render({ internal: true });
        expect(host.querySelector('.skey-internal')!.textContent).toBe('internal');
        expect(host.querySelector('.skey-row.skey-row-internal')).toBeTruthy();
    });

    it('non-internal never tagged', () => {
        render();
        expect(host.querySelector('.skey-internal')).toBeNull();
    });

    it('scopes the value viewer so rows sharing the open state stay independent', () => {
        render({ storageKey: 'one', scope: 'one', value: { a: { deep: 1 } } });
        act(() => { (host.querySelector('[aria-label="Expand $.a"]') ?? host.querySelector('[aria-label*="Expand"]') as HTMLElement)?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(host.textContent).toContain('"deep"');
        render({ storageKey: 'two', scope: 'two', value: { a: { deep: 1 } } });
        expect(host.textContent).not.toContain('"deep"');
    });

    it('delete slot renders', () => {
        render({ action: <button>Delete key</button> });
        expect(host.textContent).toContain('Delete key');
    });

    it('flashes with "changed" chip for 1.5s on a new changedAt, not on mount', () => {
        render({ changedAt: 1 });
        expect(host.querySelector('.flash')).toBeNull();
        expect(host.textContent).not.toContain('changed');
        render({ changedAt: 2 });
        expect(host.querySelector('.skey-row.flash')).toBeTruthy();
        expect(host.querySelector('.skey-changed')!.textContent).toBe('changed');
        act(() => { vi.advanceTimersByTime(1600); });
        expect(host.querySelector('.flash')).toBeNull();
        expect(host.querySelector('.skey-changed')).toBeNull();
    });
});

describe('css', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), 'src/styles', f), 'utf8') // happy-dom rewrites import.meta.url;
    it('flash is generic (app.css), 1.5s, off under reduced motion', () => {
        const app = read('app.css');
        expect(app).toMatch(/\.flash\s*\{[^}]*tdflash 1\.5s/);
        expect(app).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.flash/);
    });
    it('stacks at phone width', () => expect(read('storage.css')).toMatch(/@media \(max-width: 640px\)[\s\S]*\.skey-row/));
});
