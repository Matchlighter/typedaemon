import { EventEmitter } from 'events';
import { hypervisorPluginsSource, type PluginsHost } from './hypervisor_plugins_source';

function fakePlugin(id: string, over: any = {}, client: any = {}) {
    const connectionEvents = new EventEmitter();
    return {
        id, state: 'started', stateSince: 100,
        options: { type: 'mqtt', logging: { level: 'info' } },
        instance: { connectionEvents, connectionState: 'connected', connectionTarget: 'mqtt://broker', ...client },
        ...over,
    };
}

function setup(config: Record<string, any>, plugins: any[], apps: any[] = []) {
    const events = new EventEmitter();
    let cfgWatch: () => void;
    const host = {
        currentConfig: { plugins: config },
        listPlugins: () => plugins,
        listApplications: () => apps,
        on: (e: string, cb: any) => events.on(e, cb),
        off: (e: string, cb: any) => events.off(e, cb),
        watchConfigEntry: (_k: string, cb: () => void) => { cfgWatch = cb; return () => { cfgWatch = undefined } },
    } as unknown as PluginsHost;
    const source = hypervisorPluginsSource(host);
    let changes = 0;
    const off = source.onChange(() => changes++);
    return { source, events, plugins, off, changes: () => changes, fireConfig: () => cfgWatch?.(), host };
}

describe('hypervisorPluginsSource', () => {
    it('describes a live plugin: type, state, connection, target, log level', () => {
        const p = fakePlugin('mqtt', { options: { type: 'mqtt', url: 'mqtt://broker', logging: { level: 'debug' } } });
        const { source } = setup({ mqtt: {} }, [p]);
        expect(source.list()).toEqual([{
            id: 'mqtt', type: 'mqtt', state: 'started', since: 100, connection: 'connected',
            target: 'mqtt://broker', logLevel: 'debug', config: { type: 'mqtt', url: 'mqtt://broker', logging: { level: 'debug' } },
        }]);
    });

    it('lists configured plugins without an instance as stopped', () => {
        const { source } = setup({ ha: { type: 'home_assistant', url: 'http://ha:8123' } }, []);
        expect(source.list()).toMatchObject([{ id: 'ha', type: 'home_assistant', state: 'stopped', config: { url: 'http://ha:8123' } }]);
        expect(source.list()[0].connection).toBeUndefined();
    });

    it('omits connection and target when the plugin has none', () => {
        const p = fakePlugin('x', {}, { connectionState: undefined, connectionTarget: undefined });
        const row = setup({ x: {} }, [p]).source.list()[0];
        expect(row).not.toHaveProperty('connection');
        expect(row).not.toHaveProperty('target');
    });

    it('hides secrets in the config and credentials in the target', () => {
        const p = fakePlugin('ha', { options: { type: 'home_assistant', access_token: 'abc', logging: {} } }, { connectionTarget: 'http://u:pw@ha:8123/x' });
        const row = setup({ ha: {} }, [p]).source.list()[0];
        expect((row.config as any).access_token).toBe('***');
        expect(row.target).toBe('http://ha:8123/x');
    });

    it('notifies when a plugin connection changes', () => {
        const p = fakePlugin('mqtt');
        const { changes } = setup({ mqtt: {} }, [p]);
        p.instance.connectionEvents.emit('change');
        expect(changes()).toBe(1);
    });

    it('notifies on plugin lifecycle and config changes, and picks up connection events of plugins that start later', () => {
        const plugins: any[] = [];
        const { events, changes, fireConfig } = setup({ mqtt: {} }, plugins);
        const p = fakePlugin('mqtt');
        plugins.push(p);
        events.emit('plugin_lifecycle', p, 'started');
        expect(changes()).toBe(1);
        p.instance.connectionEvents.emit('change');
        expect(changes()).toBe(2);
        fireConfig();
        expect(changes()).toBe(3);
    });

    it('stops listening on dispose', () => {
        const p = fakePlugin('mqtt');
        const { off, changes, events } = setup({ mqtt: {} }, [p]);
        off();
        p.instance.connectionEvents.emit('change');
        events.emit('plugin_lifecycle', p, 'stopped');
        expect(changes()).toBe(0);
        expect(p.instance.connectionEvents.listenerCount('change')).toBe(0);
    });
});

describe('hypervisorPluginsSource summary and usedBy', () => {
    it('includes the plugin status line and the apps using it (sorted)', () => {
        const p = fakePlugin('http', {}, { statusSummary: [{ label: 'Routes', value: '2 routes' }] });
        const apps = [{ id: 'b', usedPlugins: new Set(['http']) }, { id: 'a', usedPlugins: new Set(['http', 'mqtt']) }, { id: 'c', usedPlugins: new Set(['mqtt']) }];
        const row = setup({ http: {} }, [p], apps).source.list()[0];
        expect(row.summary).toEqual([{ label: 'Routes', value: '2 routes' }]);
        expect(row.usedBy).toEqual(['a', 'b']);
    });

    it('omits both when there is nothing to say', () => {
        const row = setup({ x: {} }, [fakePlugin('x')], [{ id: 'a', usedPlugins: new Set() }]).source.list()[0];
        expect(row).not.toHaveProperty('summary');
        expect(row).not.toHaveProperty('usedBy');
    });
});
