import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListStates } from './ListStates';

const EMPTY = { title: 'No HTTP handlers', hint: 'Routes appear when the app calls this.http.get().' };
const render = (p: Partial<React.ComponentProps<typeof ListStates>> = {}) =>
    renderToString(<ListStates status="live" empty={EMPTY} {...p}><ul><li>row</li></ul></ListStates>);

describe('ListStates', () => {
    it('live with content renders children untouched', () => {
        const out = render();
        expect(out).toContain('<li>row</li>');
        expect(out).not.toContain('liststate-stale');
    });

    it('loading shows 3 skeleton bars and no children', () => {
        const out = render({ status: 'loading' });
        expect(out.match(/liststate-bar/g)).toHaveLength(3);
        expect(out).toContain('aria-busy="true"');
        expect(out).not.toContain('row');
    });

    it('syncing shows Syncing… status line', () => {
        const out = render({ status: 'syncing' });
        expect(out).toContain('Syncing');
        expect(out).toContain('role="status"');
        expect(out).not.toContain('row');
    });

    it('empty shows title and explanatory copy', () => {
        const out = render({ isEmpty: true });
        expect(out).toContain('No HTTP handlers');
        expect(out).toContain('Routes appear when the app calls this.http.get().');
        expect(out).not.toContain('row');
    });

    it('error shows title, detail and Try again only with onRetry', () => {
        const out = render({ status: 'error', error: { title: "Storage unavailable", detail: 'EACCES store.journal' }, onRetry: () => {} });
        expect(out).toContain("Storage unavailable");
        expect(out).toContain('EACCES store.journal');
        expect(out).toContain('Try again');
        expect(out).toContain('role="alert"');
        expect(render({ status: 'error', error: { title: 'x' } })).not.toContain('Try again');
    });

    it('stale dims content (still shown) and empty-stale stays empty', () => {
        expect(render({ status: 'stale' })).toMatch(/liststate-stale[^>]*>.*row/);
        expect(render({ status: 'stale', isEmpty: true })).toContain('No HTTP handlers');
    });
});
