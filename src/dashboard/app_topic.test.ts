import type { AppDetail } from './protocol';
import { appTopic, type AppDetailSource } from './app_topic';

const detail = (state: string): AppDetail => ({
    row: { id: 'a', name: 'a', source: 'a.ts', state: state as any, since: 1 },
    uuid: 'a', instanceOf: 'a.ts#default', packages: {}, watching: true, counts: {},
});

function setup() {
    let cb: () => void;
    let current: AppDetail | undefined = detail('started');
    const source: AppDetailSource = {
        get: () => current,
        onChange: (id, f) => { cb = f; return () => { cb = undefined } },
    };
    return { topic: appTopic(source), fire: (_id: string) => cb?.(), set: (d?: AppDetail) => { current = d } };
}

describe('app topic', () => {
    it('snapshots the app detail for the requested id', async () => {
        const { topic } = setup();
        expect(await topic.snapshot({ id: 'a' })).toEqual(detail('started'));
    });

    it('rejects unknown apps', async () => {
        const { topic, set } = setup();
        set(undefined);
        await expect(topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits the full fresh detail when the app changes', () => {
        const { topic, fire, set } = setup();
        const emitted: AppDetail[] = [];
        topic.subscribe({ id: 'a' }, d => emitted.push(d));
        set(detail('compiling'));
        fire('a');
        expect(emitted).toEqual([detail('compiling')]);
    });

    it('stops listening on unsubscribe', () => {
        const { topic, fire } = setup();
        const emitted: AppDetail[] = [];
        topic.subscribe({ id: 'a' }, d => emitted.push(d))();
        fire('a');
        expect(emitted).toEqual([]);
    });
});
