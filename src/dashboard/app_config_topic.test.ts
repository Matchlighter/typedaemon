import { appConfigTopic, type AppConfigSource } from './app_config_topic';
import type { AppConfigSnapshot } from './protocol';

const snap = (level: string): AppConfigSnapshot => ({ config: { logging: { level } }, defaults: [['logging', 'level']], file: '/c.yaml', line: 4 });

function setup() {
    let cb: (() => void) | undefined;
    let current: AppConfigSnapshot | undefined = snap('info');
    const source: AppConfigSource = { get: () => current, onChange: (_id, f) => { cb = f; return () => { cb = undefined } } };
    return { topic: appConfigTopic(source), fire: () => cb?.(), set: (s?: AppConfigSnapshot) => { current = s }, subscribed: () => !!cb };
}

describe('appConfig topic', () => {
    it('snapshots the app config for the requested id', async () => {
        expect(await setup().topic.snapshot({ id: 'a' })).toEqual(snap('info'));
    });
    it('rejects unknown apps', async () => {
        const { topic, set } = setup();
        set(undefined);
        await expect(topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });
    it('emits the full fresh snapshot on change, and stops on unsubscribe', () => {
        const { topic, fire, set, subscribed } = setup();
        const emitted: AppConfigSnapshot[] = [];
        const off = topic.subscribe({ id: 'a' }, d => emitted.push(d));
        set(snap('debug'));
        fire();
        expect(emitted).toEqual([snap('debug')]);
        off();
        expect(subscribed()).toBe(false);
    });
    it('emits nothing when the app is gone', () => {
        const { topic, fire, set } = setup();
        const emitted: AppConfigSnapshot[] = [];
        topic.subscribe({ id: 'a' }, d => emitted.push(d));
        set(undefined);
        fire();
        expect(emitted).toEqual([]);
    });
});
