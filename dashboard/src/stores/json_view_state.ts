import { makeAutoObservable, observable } from 'mobx';

export interface KeyValueHost { get(): string | null; set(v: string): void }

const KEY = 'td-json-open';
export const browserJsonHost: KeyValueHost = {
    get: () => { try { return localStorage.getItem(KEY) } catch { return null } },
    set: v => { try { localStorage.setItem(KEY, v) } catch { /* storage may be blocked in iframes */ } },
};

export type Loaded = { status: 'loading' } | { status: 'ready'; value: unknown } | { status: 'error'; error: string };
export type Loader = (path: string) => Promise<unknown>;

/**
 * Path of `path` within the viewer called `scope`, so viewers sharing one state (e.g. one per storage key) don't collide.
 * Every scoped root is `<scope>#$`; loaders receive the full scoped path.
 */
export const scopedPath = (scope: string | undefined, path: string) => scope ? `${scope}#${path}` : path;
const isRoot = (path: string) => path === '$' || path.endsWith('#$');

/**
 * UI state for JSON viewers, all keyed by JSON path (never by data identity) so it survives value refreshes.
 * Open/closed is persisted via `host` (survives app restart); show-all and lazy-load caches are session-only.
 * Root (`$`) is open unless explicitly closed.
 */
export class JsonViewState {
    private open = observable.map<string, boolean>();
    private full = observable.set<string>();
    private cache = observable.map<string, Loaded>({}, { deep: false });

    constructor(private host: KeyValueHost = browserJsonHost) {
        makeAutoObservable<JsonViewState, any>(this, { host: false }, { autoBind: true });
        try {
            const saved = JSON.parse(host.get() ?? '{}');
            if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) this.open.set(k, !!v);
        } catch { /* corrupt -> defaults */ }
    }

    /** `lazy`: the node's content isn't here yet, so even a root starts closed until asked for */
    isOpen(path: string, lazy = false) { return this.open.get(path) ?? (isRoot(path) && !lazy); }

    toggle(path: string, lazy = false) {
        this.open.set(path, !this.isOpen(path, lazy));
        this.host.set(JSON.stringify(Object.fromEntries(this.open)));
    }

    isFullString(path: string) { return this.full.has(path); }
    showAll(path: string) { this.full.add(path); }

    loaded(path: string): Loaded | undefined { return this.cache.get(path); }

    /** Fetch a lazy subtree once; errors are retried on the next call. */
    async load(path: string, loader: Loader) {
        const cur = this.cache.get(path);
        if (cur && cur.status !== 'error') return;
        this.cache.set(path, { status: 'loading' });
        await this.fetch(path, loader);
    }

    /** Re-fetch an already loaded path (its source changed). The old value stays shown until the new one arrives. */
    async refresh(path: string, loader: Loader) {
        if (!this.cache.has(path)) return;
        await this.fetch(path, loader);
    }

    private async fetch(path: string, loader: Loader) {
        try {
            this.cache.set(path, { status: 'ready', value: await loader(path) });
        } catch (e) {
            this.cache.set(path, { status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
}

let shared: JsonViewState | undefined;
/** App-wide state used when a viewer isn't given its own. */
export const sharedJsonViewState = () => shared ??= new JsonViewState();
