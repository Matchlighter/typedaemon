// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusRowWhenReady } from './focus_row';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('focusRowWhenReady', () => {
    it('scrolls to and flashes a row that appears later', async () => {
        vi.useFakeTimers();
        const scroll = vi.fn();
        (Element.prototype as any).scrollIntoView = scroll;
        focusRowWhenReady('[data-row-key="a"]', 1000);
        const el = document.createElement('div');
        el.dataset.rowKey = 'a';
        document.body.appendChild(el);
        await vi.advanceTimersByTimeAsync(300);
        expect(scroll).toHaveBeenCalled();
        expect(el.classList.contains('flash')).toBe(true);
    });
    it('stops polling after the timeout', async () => {
        vi.useFakeTimers();
        const scroll = vi.fn();
        (Element.prototype as any).scrollIntoView = scroll;
        focusRowWhenReady('[data-row-key="zz"]', 200);
        await vi.advanceTimersByTimeAsync(500);
        const el = document.createElement('div');
        el.dataset.rowKey = 'zz';
        document.body.appendChild(el);
        await vi.advanceTimersByTimeAsync(500);
        expect(scroll).not.toHaveBeenCalled();
    });
});
