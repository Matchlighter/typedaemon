import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { JsonViewer, copyJson } from './JsonViewer';
import { lazy } from './json_model';
import { JsonViewState, scopedPath } from '../stores/json_view_state';

const state = () => new JsonViewState({ get: () => null, set: () => {} });
const render = (value: unknown, extra: Partial<React.ComponentProps<typeof JsonViewer>> = {}) =>
    renderToString(<JsonViewer value={value} state={state()} {...extra} />);

describe('JsonViewer', () => {
    it('shows collapsible nodes with counts and sizes; root open', () => {
        const out = render({ a: { x: 1 }, list: [1, 2, 3] });
        expect(out).toContain('2 keys');
        expect(out).toMatch(/aria-expanded="true"/);
        expect(out).toMatch(/aria-expanded="false"/);
        expect(out).toContain('1 key');
        expect(out).toContain('3 items');
        expect(out).toContain('7 B');
    });
    it('hides children of closed nodes, shows those of open ones by path', () => {
        const s = state();
        const v = { a: { deep: 'yes' } };
        expect(renderToString(<JsonViewer value={v} state={s} />)).not.toContain('deep');
        s.toggle('$.a');
        expect(renderToString(<JsonViewer value={v} state={s} />)).toContain('deep');
    });
    it('keeps open state when the value is replaced', () => {
        const s = state();
        s.toggle('$.a');
        expect(renderToString(<JsonViewer value={{ a: { k: 1 } }} state={s} />)).toContain('&quot;k&quot;');
        expect(renderToString(<JsonViewer value={{ a: { k: 2 }, b: 1 }} state={s} />)).toContain('&quot;k&quot;');
    });
    it('scopes open state, so viewers sharing a state stay independent', () => {
        const s = state();
        const v = { a: { deep: 'yes' } };
        s.toggle(scopedPath('one', '$.a'));
        expect(renderToString(<JsonViewer value={v} state={s} scope="one" />)).toContain('deep');
        expect(renderToString(<JsonViewer value={v} state={s} scope="two" />)).not.toContain('deep');
    });
    it('renders a lazy root loaded under its scoped path', async () => {
        const s = state();
        const v = lazy({ kind: 'array', count: 2, size: 5 });
        s.toggle(scopedPath('one', '$'), true);
        await s.load(scopedPath('one', '$'), async () => [7, 8]);
        expect(renderToString(<JsonViewer value={v} state={s} scope="one" loader={async () => []} />)).toContain('<span class="json-num">7</span>');
    });
    it('shows annotations as trailing comments on the rows at their paths', () => {
        const s = state();
        s.toggle('$.o');
        const out = renderToString(<JsonViewer value={{ a: 1, b: 'x', o: { k: 2 } }} state={s} annotations={{ '$.a': 'default', '$.o.k': 'from defaults.lights', '$.o': 'object note' }} />);
        expect(out).toContain('<span class="json-num">1</span>,<span class="json-note"> // default</span>');
        expect(out).toContain('<span class="json-note"> // from defaults.lights</span>');
        expect(out).toContain('<span class="json-note"> // object note</span>');
        expect(out.match(/json-note/g)).toHaveLength(3);
    });
    it('truncates strings over 120 chars with a show all control', () => {
        const long = 'z'.repeat(200);
        const out = render({ s: long });
        expect(out).toContain('z'.repeat(120));
        expect(out).not.toContain('z'.repeat(121));
        expect(out).toContain('show all');
        const s = state(); s.showAll('$.s');
        const full = renderToString(<JsonViewer value={{ s: long }} state={s} />);
        expect(full).toContain(long);
        expect(full).not.toContain('show all');
    });
    it('marks lazy nodes and shows meta without data', () => {
        const out = render({ big: lazy({ kind: 'array', count: 48, size: 3174 }) }, { loader: async () => [] });
        expect(out).toContain('48 items');
        expect(out).toContain('3.1 KB');
        expect(out).toContain('loads on expand');
    });
    it('renders loaded lazy subtree when open', () => {
        const s = state();
        s.toggle('$.big');
        s.loaded; // eslint-disable-line
        const v = { big: lazy({ kind: 'array', count: 1, size: 3 }) };
        expect(renderToString(<JsonViewer value={v} state={s} loader={async () => ['hello']} />)).toContain('Loading');
    });
    it('has a copy button', () => {
        expect(render({ a: 1 })).toMatch(/aria-label="Copy value"/);
    });
    it('renders in monospace container', () => {
        expect(render(1)).toContain('class="json-viewer');
    });
});

describe('copyJson', () => {
    it('writes pretty JSON', async () => {
        const write = vi.fn(async () => {});
        await copyJson({ a: [1] }, '$', state(), undefined, write);
        expect(write).toHaveBeenCalledWith(JSON.stringify({ a: [1] }, null, 2));
    });
    it('loads lazy values before copying', async () => {
        const write = vi.fn(async () => {});
        await copyJson(lazy({ kind: 'array', count: 2, size: 5 }), '$.big', state(), async () => [1, 2], write);
        expect(write).toHaveBeenCalledWith(JSON.stringify([1, 2], null, 2));
    });
});
