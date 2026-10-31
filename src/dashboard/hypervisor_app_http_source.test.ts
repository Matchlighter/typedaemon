import { EventEmitter } from 'events';
import { HttpRouteRegistry } from '../plugins/http/routes';
import { appHttpCounts, hypervisorAppHttpSource, type AppHttpHost } from './hypervisor_app_http_source';

function setup(opts: { configured?: Record<string, any>; withPlugin?: boolean } = {}) {
    const routes = new HttpRouteRegistry();
    const events = new EventEmitter();
    const host = {
        getApplication: () => undefined,
        on: (e: string, cb: any) => events.on(e, cb), off: (e: string, cb: any) => events.off(e, cb),
        working_directory: '/wd',
        currentConfig: { apps: opts.configured ?? { a: { uuid: 'u-a' }, b: {} } },
        listPlugins: () => opts.withPlugin === false ? [] : [{ id: 'http', instance: { routes, port: 9100 } }, { id: 'other', instance: {} }],
    } as unknown as AppHttpHost;
    return { host, routes, events, source: hypervisorAppHttpSource(host) };
}

describe('hypervisorAppHttpSource.list', () => {
    it('maps routes to rows with the URL path under /app/<uuid>', () => {
        const { source, routes } = setup();
        routes.add({ appUuid: 'u-a', kind: 'route', method: 'GET', path: '/api/scenes', handler: 'list' });
        routes.add({ appUuid: 'other', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
        expect(source.list('a')).toEqual([{ key: '1', kind: 'route', method: 'GET', path: '/api/scenes', handler: 'list', url: '/app/u-a/api/scenes' }]);
    });

    it('shows static mounts by directory relative to the working directory; the app id is the uuid by default', () => {
        const { source, routes } = setup();
        routes.add({ appUuid: 'b', kind: 'static', path: '/ui', directory: '/wd/apps/b/www' });
        expect(source.list('b')).toEqual([{ key: '1', kind: 'static', path: '/ui', handler: 'apps/b/www', url: '/app/b/ui' }]);
    });

    it('is empty for a configured app without routes (or without an HTTP plugin) and unknown for others', () => {
        expect(setup().source.list('a')).toEqual([]);
        expect(setup({ withPlugin: false }).source.list('a')).toEqual([]);
        expect(setup().source.list('zzz')).toBeUndefined();
    });

    it('knows the plugin port', () => {
        expect(setup().source.port).toBe(9100);
        expect(setup({ withPlugin: false }).source.port).toBeUndefined();
    });
});

describe('hypervisorAppHttpSource.onChange', () => {
    it('fires for the app\'s routes only, until unsubscribed', () => {
        const { source, routes } = setup();
        const cb = jest.fn();
        const off = source.onChange('a', cb);
        routes.add({ appUuid: 'u-a', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
        routes.add({ appUuid: 'b', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        routes.add({ appUuid: 'u-a', kind: 'route', method: 'GET', path: '/y', handler: 'y' });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires on the app\'s lifecycle steps (restarts), not other apps\'', () => {
        const { source, events } = setup();
        const cb = jest.fn();
        const off = source.onChange('a', cb);
        events.emit('app_lifecycle', { id: 'b' }, 'started');
        expect(cb).not.toHaveBeenCalled();
        events.emit('app_lifecycle', { id: 'a' }, 'started');
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        expect(events.listenerCount('app_lifecycle')).toBe(0);
    });
});

describe('appHttpCounts', () => {
    it('counts routes and mounts; undefined without an HTTP plugin', () => {
        const { host, routes } = setup();
        routes.add({ appUuid: 'u-a', kind: 'route', method: 'GET', path: '/x', handler: 'x' });
        routes.add({ appUuid: 'u-a', kind: 'static', path: '/ui', directory: '/d' });
        expect(appHttpCounts(host, 'a')).toEqual({ http: 2 });
        expect(appHttpCounts(setup({ withPlugin: false }).host, 'a')).toBeUndefined();
    });
});
