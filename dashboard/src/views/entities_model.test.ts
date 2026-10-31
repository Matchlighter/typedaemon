import type { EntityRow, GlobalEntityRow } from '@protocol';
import { describe, expect, it } from 'vitest';
import { applyEntitiesDelta, displayEntityId, entityLabel, entityFacets, entitySegmentCounts, filterEntities, orphanUnlinkedHint } from './entities_model';

const row = (key: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key, plugin: 'ha', domain: 'sensor', entityId: `sensor.${key}`, linked: true, autoClean: false, persistState: false, ...over });

describe('applyEntitiesDelta', () => {
    it('replaces rows by key, appends new ones and drops removed ones', () => {
        const cur = { rows: [row('a'), row('b'), row('c')] };
        const next = applyEntitiesDelta(cur, { upsert: [row('b', { state: 'on' }), row('d')], remove: ['c'] });
        expect(next.rows).toEqual([row('a'), row('b', { state: 'on' }), row('d')]);
    });

    it('a restart (remove then re-add) ends with the same rows', () => {
        let s = { rows: [row('a')] };
        s = applyEntitiesDelta(s, { remove: ['a'] });
        expect(s.rows).toEqual([]);
        s = applyEntitiesDelta(s, { upsert: [row('a')] });
        expect(s.rows).toEqual([row('a')]);
    });
});

describe('segments', () => {
    const rows = [row('a'), row('b', { linked: false }), row('c')];

    it('counts all/linked/unlinked', () => {
        expect(entitySegmentCounts(rows)).toEqual({ all: 3, linked: 2, unlinked: 1 });
    });

    it('filters by segment, sorted by displayed id so rows do not jump', () => {
        expect(filterEntities([row('c'), row('a'), row('b', { linked: false })], {}).map(r => r.key)).toEqual(['a', 'b', 'c']);
        expect(filterEntities(rows, { segment: 'unlinked' }).map(r => r.key)).toEqual(['b']);
        expect(filterEntities(rows, { segment: 'linked' }).map(r => r.key)).toEqual(['a', 'c']);
    });
});

describe('entityLabel', () => {
    it('is the entity_id when known, else says HA has not resolved it', () => {
        expect(entityLabel(row('a'))).toBe('sensor.a');
        expect(entityLabel(row('a', { entityId: undefined }))).toBe('sensor entity (not resolved in HA)');
    });
});

describe('displayEntityId', () => {
    it('is the HA entity_id when known, else a domain placeholder', () => {
        expect(displayEntityId(row('a'))).toBe('sensor.a');
        expect(displayEntityId(row('a', { entityId: undefined }))).toBe('sensor.(unresolved)');
    });
});

describe('global entities', () => {
    const g = (key: string, app: string, over: Partial<GlobalEntityRow> = {}): GlobalEntityRow =>
        ({ ...row(key), key: `${app}/${key}`, entityKey: key, app, ...over });
    const rows = [
        g('light.a', 'lights', { domain: 'light', entityId: 'light.a' }),
        g('sensor.b', 'lights', { entityId: 'sensor.b', linked: false }),
        g('sensor.c', 'garden', { entityId: 'sensor.c', name: 'Soil moisture' }),
        g('sensor.d', 'old', { entityId: 'sensor.d', orphan: true, linked: false }),
    ];

    it('folds deltas for rows of any app', () => {
        const next = applyEntitiesDelta({ rows }, { upsert: [g('sensor.c', 'garden', { state: '5' })], remove: ['lights/light.a'] });
        expect(next.rows.map(r => r.key)).toEqual(['lights/sensor.b', 'garden/sensor.c', 'old/sensor.d']);
        expect(next.rows[1].state).toBe('5');
    });

    it('filters by app, domain, segment and search together', () => {
        const keys = (f: object) => filterEntities(rows, f).map(r => r.key);
        expect(keys({ app: 'lights' })).toEqual(['lights/light.a', 'lights/sensor.b']);
        expect(keys({ domain: 'sensor' })).toEqual(['lights/sensor.b', 'garden/sensor.c', 'old/sensor.d']);
        expect(keys({ app: 'lights', domain: 'sensor', segment: 'unlinked' })).toEqual(['lights/sensor.b']);
        expect(keys({ app: 'garden', segment: 'unlinked' })).toEqual([]);
        expect(keys({ query: 'SOIL' })).toEqual(['garden/sensor.c']);
        expect(keys({ query: 'sensor.', domain: 'light' })).toEqual([]);
    });

    it('counts each facet under the other filters (but not its own)', () => {
        const f = entityFacets(rows, { app: 'lights', segment: 'unlinked' });
        expect(f.segments).toEqual({ all: 2, linked: 1, unlinked: 1 });
        // apps: segment applies, app does not
        expect(f.apps).toEqual([{ value: 'garden', count: 0 }, { value: 'lights', count: 1 }, { value: 'old', count: 1, orphan: true }]);
        // domains: app + segment apply
        expect(f.domains).toEqual([{ value: 'light', count: 0 }, { value: 'sensor', count: 1 }]);
    });

    it('lists every app and domain even with a filter that matches nothing', () => {
        const f = entityFacets(rows, { query: 'zzz' });
        expect(f.apps.map(a => a.value)).toEqual(['garden', 'lights', 'old']);
        expect(f.apps.every(a => a.count === 0)).toBe(true);
    });
});

describe('orphanUnlinkedHint', () => {
    const r = (app: string, linked: boolean, orphan?: boolean) => ({ app, linked, orphan }) as any;
    it('names the single orphan, counts several, and is absent without unlinked orphan rows', () => {
        expect(orphanUnlinkedHint([r('a', true), r('b', false)])).toBeUndefined();
        expect(orphanUnlinkedHint([r('o', false, true), r('o', false, true), r('o', true, true)])).toMatch(/^2 unlinked belong to orphan o /);
        expect(orphanUnlinkedHint([r('o', false, true), r('p', false, true)])).toMatch(/^2 unlinked belong to 2 orphans /);
    });
});
