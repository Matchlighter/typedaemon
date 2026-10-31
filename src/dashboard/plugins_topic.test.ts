import type { PluginRow } from './protocol';
import { pluginsTopic, type PluginsSource } from './plugins_topic';

const row = (id: string, over: Partial<PluginRow> = {}): PluginRow =>
    ({ id, type: 'mqtt', state: 'started', since: 1, config: {}, ...over });

function setup(initial: PluginRow[] = [row('mqtt')]) {
    let cb: () => void;
    let current = initial;
    const source: PluginsSource = { list: () => current, onChange: f => { cb = f; return () => { cb = undefined } } };
    return { topic: pluginsTopic(source), fire: () => cb?.(), set: (r: PluginRow[]) => { current = r }, subscribed: () => !!cb };
}

describe('plugins topic', () => {
    it('snapshots every plugin', async () => {
        const rows = [row('a'), row('b')];
        expect(await setup(rows).topic.snapshot(undefined)).toEqual({ plugins: rows });
    });

    it('emits changed/new rows as upserts and vanished ones as removals', () => {
        const { topic, fire, set } = setup([row('a'), row('b'), row('c')]);
        const emitted: any[] = [];
        topic.subscribe(undefined, d => emitted.push(d));
        set([row('a'), row('b', { connection: 'reconnecting' }), row('d')]);
        fire();
        expect(emitted).toEqual([{ upsert: [row('b', { connection: 'reconnecting' }), row('d')], remove: ['c'] }]);
    });

    it('stays quiet when nothing changed, and after dispose', () => {
        const { topic, fire, set, subscribed } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe(undefined, d => emitted.push(d));
        fire();
        expect(emitted).toEqual([]);
        off();
        expect(subscribed()).toBe(false);
        set([]);
        fire();
        expect(emitted).toEqual([]);
    });
});
