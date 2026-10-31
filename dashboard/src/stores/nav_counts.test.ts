import { describe, expect, it, vi } from 'vitest';
import { NavCounts } from './nav_counts';

function fakeConn(data: Record<string, any>) {
    return { subscribe: vi.fn((topic: string) => ({ data: data[topic], status: 'live', dispose: vi.fn() })) } as any;
}

describe('NavCounts', () => {
    it('counts rows per tab and flags dead apps', () => {
        const conn = fakeConn({
            apps: { apps: [{ state: 'started' }, { state: 'dead' }, { state: 'stopped' }], orphans: [] },
            plugins: { plugins: [{}, {}] },
            counts: { entities: 4 },
        });
        const nc = new NavCounts(conn);
        const stop = nc.activate();
        expect(nc.badges).toEqual({ apps: { count: 3, errors: 1 }, plugins: { count: 2 }, entities: { count: 4 } });
        stop();
    });

    it('never subscribes to the heavy entities topic', () => {
        const conn = fakeConn({});
        new NavCounts(conn).activate();
        expect(conn.subscribe.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['apps', 'counts', 'plugins']);
    });

    it('has no badges before data arrives', () => {
        const nc = new NavCounts(fakeConn({}));
        nc.activate();
        expect(nc.badges).toEqual({});
    });
});
