import { describe, expect, it } from 'vitest';
import { ThemeStore, type ThemeHost } from './theme_store';

function host(systemDark = false, saved: string | null = null) {
    const h = {
        systemDark, saved, applied: '' as string,
        getSaved: () => h.saved,
        save: (v: string | null) => { h.saved = v },
        apply: (t: string) => { h.applied = t },
        isSystemDark: () => h.systemDark,
        onSystemChange: (cb: () => void) => { (h as any).fire = cb; },
    };
    return h as typeof h & ThemeHost & { fire: () => void };
}

describe('ThemeStore', () => {
    it('follows system preference when nothing is saved', () => {
        const h = host(true);
        const t = new ThemeStore(h);
        expect(t.theme).toBe('dark');
        expect(h.applied).toBe('dark');
        h.systemDark = false; h.fire();
        expect(t.theme).toBe('light');
    });

    it('manual toggle overrides and persists', () => {
        const h = host(false);
        const t = new ThemeStore(h);
        t.toggle();
        expect(t.theme).toBe('dark');
        expect(h.saved).toBe('dark');
        expect(h.applied).toBe('dark');
    });

    it('restores the saved choice over system preference', () => {
        const t = new ThemeStore(host(true, 'light'));
        expect(t.theme).toBe('light');
    });
});
