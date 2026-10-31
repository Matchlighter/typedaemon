import { describe, expect, it } from 'vitest';
import { appHref, appPath, entityHref, entityPath, errorLogsHref, haEntityHref, pluginHref } from './hrefs';

describe('hrefs', () => {
    it('app links escape the id; overview is the bare page', () => {
        expect(appHref('my app')).toBe('#/apps/my%20app');
        expect(appHref('my app', 'overview')).toBe('#/apps/my%20app');
        expect(appHref('lights', 'logs')).toBe('#/apps/lights/logs');
        expect(appHref('lights', 'logs', { focus: 'error' })).toBe('#/apps/lights/logs?focus=error');
        expect(appPath('a/b', 'storage')).toBe('/apps/a%2Fb/storage');
    });

    it('entity links escape the row key (it has / and :)', () => {
        expect(entityHref('lights/ha:abc-light')).toBe('#/entities/lights%2Fha%3Aabc-light');
        expect(entityPath('a b/ha:x')).toBe('/entities/a%20b%2Fha%3Ax');
    });

    it('error log links focus the given line, else the newest error', () => {
        expect(errorLogsHref('lights', 42)).toBe('#/apps/lights/logs?focus=42');
        expect(errorLogsHref('lights')).toBe('#/apps/lights/logs?focus=error');
    });

    it('plugin links escape the id', () => {
        expect(pluginHref('ha core')).toBe('#/plugins/ha%20core');
    });

    describe('haEntityHref', () => {
        it('under Ingress: root-relative, top frame (the base URL is not needed)', () => {
            expect(haEntityHref('sensor.a b', undefined, '/api/hassio_ingress/tok/')).toEqual({ href: '/config/entities?search=sensor.a%20b', target: '_top' });
            expect(haEntityHref('sensor.a', 'https://ha.example.com', '/api/hassio_ingress/tok/')?.target).toBe('_top');
        });

        it('direct access: under the base URL the server knows', () => {
            expect(haEntityHref('sensor.a', 'https://ha.example.com/', '/')).toEqual({ href: 'https://ha.example.com/config/entities?search=sensor.a', target: '_blank' });
        });

        it('no way to tell: no link', () => {
            expect(haEntityHref('sensor.a', undefined, '/')).toBeUndefined();
        });
    });
});
