import { describe, expect, it } from 'vitest';
import { RouteStore, type HashHost, parseHash } from './route_store';

function fakeHost(hash = '') {
    const listeners = new Set<() => void>();
    const host: HashHost = {
        get hash() { return hash },
        set hash(v: string) { hash = v.startsWith('#') ? v : '#' + v; listeners.forEach(l => l()); },
        onChange: cb => { listeners.add(cb); return () => listeners.delete(cb); },
    };
    return { host, setExternally: (h: string) => { hash = h; listeners.forEach(l => l()); } };
}

describe('parseHash', () => {
    it('splits path segments and query', () => {
        expect(parseHash('#/apps/lights?tab=logs&x=1')).toEqual({
            path: '/apps/lights', segments: ['apps', 'lights'], query: { tab: 'logs', x: '1' },
        });
    });
    it('treats empty hash as root', () => {
        expect(parseHash('')).toEqual({ path: '/', segments: [], query: {} });
        expect(parseHash('#')).toEqual({ path: '/', segments: [], query: {} });
    });
    it('decodes segments', () => {
        expect(parseHash('#/apps/a%20b').segments).toEqual(['apps', 'a b']);
    });
});

describe('RouteStore', () => {
    it('reads the initial location from the hash (survives reload)', () => {
        const { host } = fakeHost('#/entities');
        expect(new RouteStore(host).segments).toEqual(['entities']);
    });

    it('navigate writes the hash and updates observable state', () => {
        const { host } = fakeHost('');
        const r = new RouteStore(host);
        r.navigate('/apps/lights', { tab: 'logs' });
        expect(host.hash).toBe('#/apps/lights?tab=logs');
        expect(r.path).toBe('/apps/lights');
        expect(r.query).toEqual({ tab: 'logs' });
    });

    it('follows external hash changes (back/forward)', () => {
        const { host, setExternally } = fakeHost('');
        const r = new RouteStore(host);
        setExternally('#/logs');
        expect(r.section).toBe('logs');
    });

    it('section defaults to overview at root; helper builds hrefs', () => {
        const r = new RouteStore(fakeHost('').host);
        expect(r.section).toBe('overview');
        expect(RouteStore.href('/apps', { a: 'b c' })).toBe('#/apps?a=b%20c');
    });
});
