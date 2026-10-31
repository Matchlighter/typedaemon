import { appHttpTopic, type AppHttpSource } from './app_http_topic';
import type { HttpRouteRow } from './protocol';

const row = (key: string, over: Partial<HttpRouteRow> = {}): HttpRouteRow => ({ key, kind: 'route', method: 'GET', path: '/a', handler: 'a', url: '/app/u/a', ...over });

function setup(initial: HttpRouteRow[] | null = [row('1')]) {
    let cb: (() => void) | undefined;
    let current = initial ?? undefined;
    const source: AppHttpSource = { port: 9000, list: () => current, onChange: (_id, f) => { cb = f; return () => { cb = undefined } } };
    return { topic: appHttpTopic(source), fire: () => cb?.(), set: (r: HttpRouteRow[]) => { current = r }, subscribed: () => !!cb };
}

describe('appHttp topic', () => {
    it('snapshots the port and routes of the requested app', async () => {
        expect(await setup().topic.snapshot({ id: 'x' })).toEqual({ port: 9000, rows: [row('1')] });
    });

    it('rejects unknown apps', async () => {
        await expect(setup(null).topic.snapshot({ id: 'zzz' })).rejects.toThrow(/Unknown app: zzz/);
    });

    it('emits new routes as upserts and gone ones (app restart) as removals', () => {
        const { topic, fire, set } = setup([row('1'), row('2')]);
        const emitted: any[] = [];
        topic.subscribe({ id: 'x' }, d => emitted.push(d));
        set([row('3')]);
        fire();
        expect(emitted).toEqual([{ upsert: [row('3')], remove: ['1', '2'] }]);
    });

    it('stays quiet when nothing changed, and stops on unsubscribe', () => {
        const { topic, fire, subscribed } = setup();
        const emitted: any[] = [];
        const off = topic.subscribe({ id: 'x' }, d => emitted.push(d));
        fire();
        expect(emitted).toEqual([]);
        off();
        expect(subscribed()).toBe(false);
    });
});
