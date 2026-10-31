import { describe, expect, it, vi } from 'vitest';
import { JsonViewState, scopedPath, type KeyValueHost } from './json_view_state';

const memHost = (init: string | null = null): KeyValueHost & { saved: string | null } => {
    const h = { saved: init, get: () => h.saved, set: (v: string) => { h.saved = v; } };
    return h;
};

describe('open state', () => {
    it('defaults root open, others closed', () => {
        const s = new JsonViewState(memHost());
        expect(s.isOpen('$')).toBe(true);
        expect(s.isOpen('$.a')).toBe(false);
    });
    it('toggles per path and remembers an explicit close of root', () => {
        const s = new JsonViewState(memHost());
        s.toggle('$.a');
        expect(s.isOpen('$.a')).toBe(true);
        s.toggle('$');
        expect(s.isOpen('$')).toBe(false);
    });
    it('survives restart via the host', () => {
        const h = memHost();
        new JsonViewState(h).toggle('$.a.b');
        expect(new JsonViewState(h).isOpen('$.a.b')).toBe(true);
    });
    it('tolerates corrupt saved data', () => {
        expect(new JsonViewState(memHost('{nope')).isOpen('$')).toBe(true);
    });
});

describe('long strings', () => {
    it('show-all is per path', () => {
        const s = new JsonViewState(memHost());
        s.showAll('$.a');
        expect(s.isFullString('$.a')).toBe(true);
        expect(s.isFullString('$.b')).toBe(false);
    });
});

describe('lazy loading', () => {
    it('loads once via loader, exposing status and value', async () => {
        const s = new JsonViewState(memHost());
        const loader = vi.fn(async (_p: string) => [1, 2]);
        expect(s.loaded('$.big')).toBeUndefined();
        const p = s.load('$.big', loader);
        expect(s.loaded('$.big')).toEqual({ status: 'loading' });
        await p;
        await s.load('$.big', loader);
        expect(loader).toHaveBeenCalledOnce();
        expect(loader).toHaveBeenCalledWith('$.big');
        expect(s.loaded('$.big')).toEqual({ status: 'ready', value: [1, 2] });
    });
    it('records errors and allows retry', async () => {
        const s = new JsonViewState(memHost());
        await s.load('$.x', async () => { throw new Error('boom'); });
        expect(s.loaded('$.x')).toEqual({ status: 'error', error: 'boom' });
        await s.load('$.x', async () => 5);
        expect(s.loaded('$.x')).toEqual({ status: 'ready', value: 5 });
    });
});

describe('scoped roots (several viewers sharing one state)', () => {
    it('each scope has its own root, open by default, and its own persisted open state', () => {
        const h = memHost();
        const s = new JsonViewState(h);
        const a = scopedPath('a', '$'), b = scopedPath('b', '$');
        expect(s.isOpen(a)).toBe(true);
        s.toggle(a);
        expect(s.isOpen(a)).toBe(false);
        expect(s.isOpen(b)).toBe(true);
        s.toggle(scopedPath('b', '$.x'));
        expect(new JsonViewState(h).isOpen(scopedPath('b', '$.x'))).toBe(true);
        expect(new JsonViewState(h).isOpen(scopedPath('a', '$.x'))).toBe(false);
    });
    it('unscoped paths are unchanged', () => {
        expect(scopedPath(undefined, '$.a')).toBe('$.a');
    });
});

describe('lazy roots', () => {
    it('start closed (opening one is what asks the server for it); toggling works from that default', () => {
        const s = new JsonViewState(memHost());
        const root = scopedPath('big', '$');
        expect(s.isOpen(root, true)).toBe(false);
        s.toggle(root, true);
        expect(s.isOpen(root, true)).toBe(true);
        expect(new JsonViewState(memHost(JSON.stringify({ [root]: true }))).isOpen(root, true)).toBe(true);
    });
});

describe('refresh', () => {
    it('reloads a loaded path keeping the old value until the new one arrives', async () => {
        const s = new JsonViewState(memHost());
        await s.load('$', async () => 1);
        let release: (v: number) => void;
        const p = s.refresh('$', () => new Promise<number>(r => { release = r }));
        expect(s.loaded('$')).toEqual({ status: 'ready', value: 1 });
        release!(2);
        await p;
        expect(s.loaded('$')).toEqual({ status: 'ready', value: 2 });
    });
    it('does nothing for paths that were never loaded', async () => {
        const s = new JsonViewState(memHost());
        const loader = vi.fn(async () => 1);
        await s.refresh('$', loader);
        expect(loader).not.toHaveBeenCalled();
    });
});
