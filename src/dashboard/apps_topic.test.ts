import type { AppRow } from './protocol';
import { appsTopic, type AppsChange, type AppsSource } from './apps_topic';

const row = (id: string, state: AppRow['state'] = 'started'): AppRow => ({ id, name: id, source: `apps/${id}.ts`, state, since: 1 });

function fakeSource(init: { apps: AppRow[]; orphans: string[] }) {
    let listener: (c: AppsChange) => void;
    const off = jest.fn();
    const source: AppsSource = {
        list: () => init.apps,
        orphans: async () => init.orphans.map(id => ({ id })),
        onChange: cb => { listener = cb; return off },
    };
    return { source, fire: (c: AppsChange) => listener(c), off, init };
}

describe('apps topic', () => {
    it('snapshot carries apps and orphans', async () => {
        const { source } = fakeSource({ apps: [row('a')], orphans: ['gone'] });
        expect(await appsTopic(source).snapshot()).toEqual({ apps: [row('a')], orphans: [{ id: 'gone' }] });
    });

    it('forwards app changes as upserts and removals', () => {
        const { source, fire } = fakeSource({ apps: [], orphans: [] });
        const emit = jest.fn();
        appsTopic(source).subscribe(undefined, emit);
        fire({ type: 'app', row: row('a', 'stopping') });
        fire({ type: 'removed', id: 'b' });
        expect(emit).toHaveBeenNthCalledWith(1, { upsert: [row('a', 'stopping')] });
        expect(emit).toHaveBeenNthCalledWith(2, { remove: ['b'] });
    });

    it('re-reads orphans when they change', async () => {
        const { source, fire, init } = fakeSource({ apps: [], orphans: [] });
        const emit = jest.fn();
        appsTopic(source).subscribe(undefined, emit);
        init.orphans = ['old'];
        fire({ type: 'orphans' });
        await new Promise(r => setImmediate(r));
        expect(emit).toHaveBeenCalledWith({ orphans: [{ id: 'old' }] });
    });

    it('unsubscribes from the source', () => {
        const { source, off } = fakeSource({ apps: [], orphans: [] });
        appsTopic(source).subscribe(undefined, jest.fn())();
        expect(off).toHaveBeenCalled();
    });
});
