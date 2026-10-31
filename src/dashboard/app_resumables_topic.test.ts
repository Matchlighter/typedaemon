import type { AppResumablesSnapshot, ResumableRow, ScriptRow } from './protocol';
import { appResumablesTopic, type AppResumablesSource } from './app_resumables_topic';

const res = (key: string, over: Partial<ResumableRow> = {}): ResumableRow =>
    ({ key, status: 'running', type: 'resumable', owner: 'a', method: 'm', params: [], startedAt: 1, restarts: 0, ...over });
const scr = (key: string, over: Partial<ScriptRow> = {}): ScriptRow =>
    ({ key, mode: 'single', limit: 1, running: 0, queued: 0, runs: [], ...over });

function setup(initial: AppResumablesSnapshot | null = { resumables: [res('1')], scripts: [scr('s')] }) {
    let cb: (() => void) | undefined;
    let current = initial ?? undefined;
    const source: AppResumablesSource = { get: () => current, onChange: (_id, f) => { cb = f; return () => { cb = undefined } } };
    return { topic: appResumablesTopic(source), fire: () => cb?.(), set: (s: AppResumablesSnapshot) => { current = s }, subscribed: () => !!cb };
}

describe('appResumables topic', () => {
    it('snapshots the resumables and scripts of the requested app', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ resumables: [res('1')], scripts: [scr('s')] });
    });

    it('rejects unknown apps', async () => {
        await expect(setup(null).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits appeared/changed rows as upserts and gone ones as removals, per list', () => {
        const { topic, fire, set } = setup({ resumables: [res('1'), res('2')], scripts: [scr('s'), scr('t')] });
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        set({ resumables: [res('2', { status: 'suspended' }), res('3')], scripts: [scr('s'), scr('t', { running: 1, limit: 1 })] });
        fire();
        expect(emitted).toEqual([{
            resumables: { upsert: [res('2', { status: 'suspended' }), res('3')], remove: ['1'] },
            scripts: { upsert: [scr('t', { running: 1, limit: 1 })] },
        }]);
    });

    it('stays quiet when nothing changed, and stops after unsubscribe', () => {
        const { topic, fire, subscribed } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe({ id: 'x' }, d => emitted.push(d));
        fire();
        expect(emitted).toEqual([]);
        off();
        expect(subscribed()).toBe(false);
    });

    it('treats an app that vanished as having nothing', () => {
        const { topic, fire, set } = setup();
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        set(undefined as any);
        fire();
        expect(emitted).toEqual([{ resumables: { remove: ['1'] }, scripts: { remove: ['s'] } }]);
    });
});
