import type { AppRow, AppsSnapshot } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyAppsDelta, filterApps, segmentCounts } from './apps_model';

const row = (id: string, state: AppRow['state'] = 'started', over: Partial<AppRow> = {}): AppRow =>
    ({ id, name: id, source: `apps/${id}.ts`, state, since: 1, ...over });
const snap = (apps: AppRow[], orphans: string[] = []): AppsSnapshot => ({ apps, orphans: orphans.map(id => ({ id })) });

describe('applyAppsDelta', () => {
    it('replaces rows by id and adds new ones', () => {
        const next = applyAppsDelta(snap([row('a'), row('b')]), { upsert: [row('a', 'stopping'), row('c')] });
        expect(next.apps.map(r => [r.id, r.state])).toEqual([['a', 'stopping'], ['b', 'started'], ['c', 'started']]);
    });
    it('removes ids', () => {
        expect(applyAppsDelta(snap([row('a'), row('b')]), { remove: ['a'] }).apps.map(r => r.id)).toEqual(['b']);
    });
    it('replaces orphans wholesale and leaves apps alone when absent', () => {
        const next = applyAppsDelta(snap([row('a')], ['x']), { orphans: [{ id: 'y' }] });
        expect(next.orphans).toEqual([{ id: 'y' }]);
        expect(next.apps).toHaveLength(1);
        expect(applyAppsDelta(next, { remove: [] }).orphans).toEqual([{ id: 'y' }]);
    });
});

describe('segments and filtering', () => {
    const rows = [row('lights'), row('boot', 'compiling'), row('broken', 'dead'), row('off', 'stopped'), row('Heat', 'started', { name: 'Heating', source: 'apps/climate/index.ts' })];

    it('counts: running includes in-flight states', () => {
        expect(segmentCounts(rows)).toEqual({ all: 5, running: 3, dead: 1, stopped: 1 });
    });
    it('filters by segment', () => {
        expect(filterApps(rows, 'dead', '').map(r => r.id)).toEqual(['broken']);
        expect(filterApps(rows, 'running', '').map(r => r.id)).toEqual(['lights', 'boot', 'Heat']);
    });
    it('text filter matches id, name and source, case-insensitively', () => {
        expect(filterApps(rows, 'all', 'heat').map(r => r.id)).toEqual(['Heat']);
        expect(filterApps(rows, 'all', 'CLIMATE').map(r => r.id)).toEqual(['Heat']);
        expect(filterApps(rows, 'all', 'bro').map(r => r.id)).toEqual(['broken']);
    });
    it('keeps the given (config) order', () => {
        expect(filterApps(rows, 'all', '').map(r => r.id)).toEqual(['lights', 'boot', 'broken', 'off', 'Heat']);
    });
});
