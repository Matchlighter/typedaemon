import type { AppDetail } from '@protocol';
import { describe, expect, it } from 'vitest';
import { TOPIC_REDUCERS } from './topic_reducers';

const detail = (over: Partial<AppDetail> = {}): AppDetail => ({ row: { id: 'a', name: 'a', source: 'a.ts', state: 'started', since: 0 }, uuid: 'a', instanceOf: 'a.ts#default', packages: {}, watching: true, counts: {}, ...over });

describe('TOPIC_REDUCERS', () => {
    it('app replaces the detail wholesale (so cleared fields really clear)', () => {
        const dead = detail({ failure: { message: 'x', phase: 'starting', frames: [] } });
        expect(TOPIC_REDUCERS.app(dead, detail(), { id: 'a' }).failure).toBeUndefined();
    });

    it('system merges', () => {
        const cur = { version: 'v', nodeVersion: '22.11.0', startedAt: 1, now: 2, state: 'running' as const, crossCalls: [] };
        expect(TOPIC_REDUCERS.system(cur, { now: 9 }, undefined)).toEqual({ ...cur, now: 9 });
    });

    it('system replaces on a full snapshot delta (cleared fields clear)', () => {
        const cur = { version: 'v', nodeVersion: '22.11.0', startedAt: 1, now: 2, state: 'running' as const, crossCalls: [], configPath: '/c' };
        const next = { version: 'v', nodeVersion: '22.11.0', startedAt: 1, now: 5, state: 'shutting_down' as const, crossCalls: [] };
        expect(TOPIC_REDUCERS.system(cur, next, undefined)).toEqual(next);
    });

    it("logs keep as many lines as the subscription's limit", () => {
        const r = (id: number) => ({ id }) as any;
        const out = TOPIC_REDUCERS.logs({ entries: [r(1), r(2)] }, { append: [r(3), r(4)] }, { limit: 3 });
        expect(out.entries.map(e => e.id)).toEqual([2, 3, 4]);
    });
});
