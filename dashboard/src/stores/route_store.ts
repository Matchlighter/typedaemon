import { makeAutoObservable } from 'mobx';

export interface ParsedHash {
    path: string;
    segments: string[];
    query: Record<string, string>;
}

/** `#/apps/foo?tab=logs` -> {path:'/apps/foo', segments:['apps','foo'], query:{tab:'logs'}} */
export function parseHash(hash: string): ParsedHash {
    const raw = hash.replace(/^#/, '');
    const [p, q = ''] = raw.split('?', 2);
    const segments = p.split('/').filter(Boolean).map(decodeURIComponent);
    const query: Record<string, string> = {};
    new URLSearchParams(q).forEach((v, k) => { query[k] = v; });
    return { path: '/' + segments.join('/'), segments, query };
}

/** Abstraction over location.hash so the store is testable without a DOM. */
export interface HashHost {
    hash: string;
    onChange(cb: () => void): () => void;
}

export const windowHashHost: HashHost = {
    get hash() { return window.location.hash },
    set hash(v: string) { window.location.hash = v },
    onChange: cb => {
        window.addEventListener('hashchange', cb);
        return () => window.removeEventListener('hashchange', cb);
    },
};

/** MobX hash router. `section` = first segment (nav item key); `segments`/`query` for views to interpret. */
export class RouteStore {
    path = '/';
    segments: string[] = [];
    query: Record<string, string> = {};

    constructor(private host: HashHost = windowHashHost) {
        makeAutoObservable<RouteStore, any>(this, { host: false }, { autoBind: true });
        this.sync();
        host.onChange(this.sync);
    }

    get section() { return this.segments[0] ?? 'overview'; }

    static href(path: string, query?: Record<string, string>) {
        const q = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString().replace(/\+/g, '%20') : '';
        return `#${path}${q}`;
    }

    navigate(path: string, query?: Record<string, string>) {
        this.host.hash = RouteStore.href(path, query);
        this.sync();
    }

    private sync() {
        const p = parseHash(this.host.hash);
        this.path = p.path;
        this.segments = p.segments;
        this.query = p.query;
    }
}
