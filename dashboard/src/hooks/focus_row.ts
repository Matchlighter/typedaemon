/**
 * After a palette jump the target view may still be mounting/syncing: poll for `selector` and, once it exists,
 * scroll it into view, focus it and flash it. Gives up after `timeoutMs`. Returns a cancel function.
 */
export function focusRowWhenReady(selector: string, timeoutMs = 4000): () => void {
    const started = Date.now();
    const timer = setInterval(() => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
            clearInterval(timer);
            el.scrollIntoView?.({ block: 'center' });
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            el.focus({ preventScroll: true });
            el.classList.add('flash');
            setTimeout(() => el.classList.remove('flash'), 1500);
        } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
        }
    }, 100);
    return () => clearInterval(timer);
}
