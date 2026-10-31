// @vitest-environment happy-dom
import type { LogRow } from '@protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubLayout } from '../test/layout';
import { LogList, type LogListProps } from './LogList';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

stubLayout({ viewport: 300, row: 25 });

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const rows = (n: number, over: (i: number) => Partial<LogRow> = () => ({})): LogRow[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, ts: i, level: 'info', source: { kind: 'app', id: 'a' }, channel: 'user', message: `line ${i + 1}`, ...over(i + 1) }));
const render = (p: Partial<LogListProps> & { rows: LogRow[] }) =>
    act(() => root.render(<LogList follow={false} isExpanded={() => false} onToggle={() => { }} {...p} />));
const scroller = () => host.querySelector<HTMLElement>('.loglist')!;
const lines = () => [...host.querySelectorAll('.log-msg')].map(e => e.textContent);

describe('LogList', () => {
    it('renders only the lines in view (plus overscan) however many there are', () => {
        render({ rows: rows(20_000) });
        expect(lines().length).toBeGreaterThan(5);
        expect(lines().length).toBeLessThan(60);
        expect(lines()[0]).toBe('line 1');
    });

    it('while following, sits at the newest line and keeps up with new ones', () => {
        const all = rows(10_000);
        render({ rows: all, follow: true });
        expect(lines()).toContain('line 10000');
        expect(lines()).not.toContain('line 1');
        render({ rows: [...all, ...rows(3).map(r => ({ ...r, id: 10_000 + r.id, message: `new ${r.id}` }))], follow: true });
        expect(lines()).toContain('new 3');
    });

    it('when not following, new lines do not move the view', () => {
        const all = rows(1000);
        render({ rows: all });
        render({ rows: [...all, { ...all[0], id: 5000, message: 'late' }] });
        expect(lines()[0]).toBe('line 1');
    });

    it('scrolls to the focused line and marks it', () => {
        render({ rows: rows(10_000), focusId: 5000 });
        expect(lines()).toContain('line 5000');
        expect(host.querySelector('.log-focus .log-msg')!.textContent).toBe('line 5000');
    });

    it('centres the focused line in the page as well as the list', async () => {
        const spy = vi.fn();
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, o?: any) { if (this.classList.contains('log-focus')) spy(o); };
        try {
            render({ rows: rows(10_000), focusId: 5000 });
            await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ block: 'center' }));
        } finally { Element.prototype.scrollIntoView = orig; }
    });

    it('marks the focus on error lines too (styled by overlay, not background)', () => {
        render({ rows: rows(50, i => ({ level: i === 5 ? 'error' : 'info' })), focusId: 5 });
        expect(host.querySelector('.log-focus .log-error')).not.toBeNull();
    });

    it('tells the owner when the user scrolls away from the tail while following', () => {
        const onScrollAway = vi.fn();
        render({ rows: rows(1000), follow: true, onScrollAway });
        expect(onScrollAway).not.toHaveBeenCalled();
        act(() => { scroller().scrollTop = 0; scroller().dispatchEvent(new Event('scroll')); });
        expect(onScrollAway).toHaveBeenCalled();
    });

    it('does not report scrolling while not following', () => {
        const onScrollAway = vi.fn();
        render({ rows: rows(1000), follow: false, onScrollAway });
        act(() => { scroller().scrollTop = 0; scroller().dispatchEvent(new Event('scroll')); });
        expect(onScrollAway).not.toHaveBeenCalled();
    });

    it('stack expansion is controlled by the owner (survives rows unmounting on scroll)', () => {
        const onToggle = vi.fn();
        const withStack = rows(5, i => ({ level: 'error', stack: [{ file: 'a.ts', line: i }] }));
        render({ rows: withStack, isExpanded: id => id === 2, onToggle });
        expect(host.querySelectorAll('.log-stack')).toHaveLength(1);
        act(() => host.querySelectorAll<HTMLButtonElement>('.log-stack-toggle')[0].click());
        expect(onToggle).toHaveBeenCalledWith(1, true);
    });

    it('has a label for assistive tech and no live-announcing of the stream', () => {
        render({ rows: rows(3) });
        expect(scroller().getAttribute('role')).toBe('log');
        expect(scroller().getAttribute('aria-live')).toBe('off');
        expect(scroller().getAttribute('tabindex')).toBe('0');
    });
});
