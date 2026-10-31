import { hypervisorAppConfigSource, type AppConfigHost } from './hypervisor_app_config_source';

function host(over: Partial<Record<keyof AppConfigHost, any>> = {}) {
    const watchers: Array<[string, () => void]> = [];
    const h: any = {
        currentConfig: { apps: { a: { source: '/w/a.ts', export: null, logging: { level: 'info', file: 'f' } } } },
        configFile: '/w/config.yaml',
        rawAppConfig: (id: string) => id === 'a' ? { source: 'a.ts', logging: { file: 'f' } } : undefined,
        watchConfigEntry: (entry: string, cb: () => void) => { watchers.push([entry, cb]); return () => { watchers.splice(0, watchers.length) } },
        ...over,
    };
    return { h: h as AppConfigHost, watchers };
}
const text = 'apps:\n  b: {}\n  a:\n    source: a.ts\n';

describe('hypervisorAppConfigSource', () => {
    it('gives the resolved config, annotated with what the file did not give, and where the app is configured', () => {
        const s = hypervisorAppConfigSource(host().h, () => text);
        expect(s.get('a')).toEqual({
            config: { source: '/w/a.ts', export: null, logging: { level: 'info', file: 'f' } },
            defaults: [['export'], ['logging', 'level']],
            file: '/w/config.yaml', line: 3,
        });
    });

    it('redacts secret-looking values', () => {
        const s = hypervisorAppConfigSource(host({ currentConfig: { apps: { a: { source: 'a.ts', config: { api_key: 'k', url: 'u' } } } } }).h, () => text);
        expect(s.get('a')?.config).toEqual({ source: 'a.ts', config: { api_key: '***', url: 'u' } });
    });

    it('omits the line when the file cannot be read', () => {
        const s = hypervisorAppConfigSource(host().h, () => { throw new Error('nope') });
        expect(s.get('a')).toEqual(expect.objectContaining({ file: '/w/config.yaml', line: undefined }));
    });

    it('is undefined for an app that is not configured', () => {
        expect(hypervisorAppConfigSource(host().h, () => text).get('zzz')).toBeUndefined();
    });

    it('fires on changes to the apps config, and can stop', () => {
        const { h, watchers } = host();
        const cb = jest.fn();
        const off = hypervisorAppConfigSource(h, () => text).onChange('a', cb);
        expect(watchers.map(w => w[0])).toEqual(['apps']);
        watchers[0][1]();
        expect(cb).toHaveBeenCalledTimes(1);
        off();
        expect(watchers).toEqual([]);
    });
});
