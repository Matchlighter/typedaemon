import { makeAutoObservable } from 'mobx';

export type Theme = 'light' | 'dark';

export interface ThemeHost {
    getSaved(): string | null;
    save(v: Theme | null): void;
    apply(t: Theme): void;
    isSystemDark(): boolean;
    onSystemChange(cb: () => void): void;
}

const KEY = 'td-theme';
export const browserThemeHost: ThemeHost = {
    getSaved: () => { try { return localStorage.getItem(KEY) } catch { return null } },
    save: v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY) } catch { /* storage may be blocked in iframes */ } },
    apply: t => { document.documentElement.dataset.theme = t },
    isSystemDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    onSystemChange: cb => window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb),
};

/** Resolved theme = saved manual choice, else system preference. Writes `data-theme` on <html>. */
export class ThemeStore {
    private manual: Theme | null = null;
    private system: Theme = 'light';

    constructor(private host: ThemeHost = browserThemeHost) {
        makeAutoObservable<ThemeStore, any>(this, { host: false }, { autoBind: true });
        const saved = host.getSaved();
        this.manual = saved === 'light' || saved === 'dark' ? saved : null;
        this.readSystem();
        host.onSystemChange(this.readSystem);
        this.apply();
    }

    get theme(): Theme { return this.manual ?? this.system; }

    toggle() {
        this.manual = this.theme === 'dark' ? 'light' : 'dark';
        this.host.save(this.manual);
        this.apply();
    }

    private readSystem() {
        this.system = this.host.isSystemDark() ? 'dark' : 'light';
        this.apply();
    }
    private apply() { this.host.apply(this.theme); }
}
