import { afterEach, beforeEach, vi } from 'vitest';

/**
 * happy-dom does no layout: give the viewport and rows the sizes a browser would, so virtualized lists render their window.
 * Registers its own beforeEach/afterEach; call once at file top.
 */
export function stubLayout({ viewport = 300, row = 25 } = {}) {
    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(viewport);
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(row);
        // scrollHeight = the list body's height; scrollTo moves the view and announces it, as a browser does
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
            return parseInt((this.firstElementChild as HTMLElement | null)?.style.height || '0');
        });
        HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts: any) { this.scrollTop = opts.top; this.dispatchEvent(new Event('scroll')) } as any;
    });
    afterEach(() => vi.restoreAllMocks());
}
