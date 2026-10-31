import type { HttpRouteRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyHttpDelta, displayPath, fullUrl } from './http_model';

const row = (key: string, over: Partial<HttpRouteRow> = {}): HttpRouteRow => ({ key, kind: 'route', method: 'GET', path: '/a', handler: 'a', url: '/app/u/a', ...over });

describe('http model', () => {
    it('folds upserts and removals into the snapshot, keeping the port', () => {
        const next = applyHttpDelta({ port: 9000, rows: [row('1'), row('2')] }, { upsert: [row('3')], remove: ['1'] });
        expect(next).toEqual({ port: 9000, rows: [row('2'), row('3')] });
    });

    it('shows static mounts as a wildcard under their prefix', () => {
        expect(displayPath(row('1', { kind: 'static', path: '/ui' }))).toBe('/ui/*');
        expect(displayPath(row('1', { kind: 'static', path: '/ui/' }))).toBe('/ui/*');
        expect(displayPath(row('1', { kind: 'static', path: '/' }))).toBe('/*');
        expect(displayPath(row('1', { path: '/scenes/:id' }))).toBe('/scenes/:id');
    });

    it('builds the full URL on the page\'s host and the plugin port', () => {
        const here = { protocol: 'https:', hostname: 'homeassistant.local' };
        expect(fullUrl(row('1', { url: '/app/lights/api/scenes' }), 9000, here)).toBe('https://homeassistant.local:9000/app/lights/api/scenes');
        expect(fullUrl(row('1', { kind: 'static', url: '/app/lights/ui' }), 9000, here)).toBe('https://homeassistant.local:9000/app/lights/ui/');
        expect(fullUrl(row('1', { url: '/app/l/x' }), undefined, here)).toBe('/app/l/x');
    });
});
