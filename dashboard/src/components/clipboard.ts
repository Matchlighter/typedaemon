/**
 * Copy text to the clipboard. The async API is unavailable or blocked where the dashboard commonly runs (HA panel
 * iframes without the `clipboard-write` permission, plain-http origins), so fall back to `execCommand('copy')`.
 * Rejects if neither works.
 */
export async function copyText(text: string, nav: { clipboard?: { writeText(t: string): Promise<void> } } = navigator): Promise<void> {
    try {
        if (nav.clipboard) return await nav.clipboard.writeText(text);
    } catch { /* blocked: fall through */ }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.append(ta);
    try {
        ta.focus();
        ta.select();
        if (!document.execCommand('copy')) throw new Error("Couldn't copy to the clipboard");
    } finally {
        ta.remove();
        prevFocus?.focus?.();
    }
}
