import type { EntityRow, OrphanLeftovers } from '@protocol';
import { describe, expect, it } from 'vitest';
import { cleanupPlan, cleanupWill } from './orphan_model';

const ent = (n: string, over: Partial<EntityRow> = {}): EntityRow =>
    ({ key: `ha:${n}`, plugin: 'ha', domain: 'binary_sensor', entityId: `binary_sensor.${n}`, linked: false, autoClean: true, persistState: false, ...over });

const leftovers = (over: Partial<OrphanLeftovers> = {}): OrphanLeftovers => ({
    dir: { path: '.typedaemon/app_environments/old_presence', bytes: 49152, files: 7 },
    storage: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, value: i, size: 1, writtenAt: 0, internal: i > 9 })),
    entities: [ent('old_presence_home'), ent('old_presence_away'), ent('old_presence_count')],
    destroyers: [{ uuid: 'HAEntities-1', type: 'HAEntities', options: { plugin_id: 'home_assistant' } }, { uuid: 'X-2', type: 'Other', options: {} }],
    ...over,
});

describe('cleanupPlan', () => {
    it('names the destroyers, the first entity and how many more, the stored keys and the directory', () => {
        expect(cleanupPlan(leftovers())).toEqual({
            destroyers: 'Run 2 destroyers (HAEntities, Other): remove 3 entities from Home Assistant (binary_sensor.old_presence_away +2)',
            files: "delete its operating directory (.typedaemon/app_environments/old_presence: 48.0 KB in 7 files) and its 12 stored keys",
        });
    });

    it('lists entities in the same order the leftovers list shows them (by id)', () => {
        expect(cleanupPlan(leftovers()).destroyers).toContain('binary_sensor.old_presence_away +2');
    });

    it('says "entity" for one and omits the entity part when there is none', () => {
        expect(cleanupPlan(leftovers({ entities: [ent('a')] })).destroyers).toBe('Run 2 destroyers (HAEntities, Other): remove 1 entity from Home Assistant (binary_sensor.a)');
        expect(cleanupPlan(leftovers({ entities: [] })).destroyers).toBe('Run 2 destroyers (HAEntities, Other)');
    });

    it('only promises entity removal when the entity destroyer is among them', () => {
        const other = [{ uuid: 'X-2', type: 'Other', options: {} }];
        expect(cleanupPlan(leftovers({ destroyers: other })).destroyers).toBe('Run 1 destroyer (Other)');
    });

    it('has no destroyer part when nothing is registered', () => {
        expect(cleanupPlan(leftovers({ destroyers: [], entities: [] })).destroyers).toBeUndefined();
    });

    it('singular forms and no stored keys', () => {
        const p = cleanupPlan(leftovers({ destroyers: [{ uuid: 'a', type: 'HAEntities', options: {} }], storage: [], dir: { path: 'd', bytes: 10, files: 1 } }));
        expect(p.destroyers).toMatch(/^Run 1 destroyer \(HAEntities\)/);
        expect(p.files).toBe('delete its operating directory (d: 10 B in 1 file)');
    });

    it('uses the entity name when HA has not told the entity_id yet', () => {
        const p = cleanupPlan(leftovers({ entities: [ent('x', { entityId: undefined, domain: 'sensor' })] }));
        expect(p.destroyers).toContain('(sensor entity (not resolved in HA))');
    });
});

describe('cleanupWill', () => {
    it('chains destroyers and the file deletion', () => {
        expect(cleanupWill(leftovers())).toMatch(/^Run 2 destroyers \(HAEntities, Other\).*, then delete its operating directory/);
    });
    it('capitalizes the file step when there are no destroyers', () => {
        expect(cleanupWill(leftovers({ destroyers: [], entities: [] }))).toMatch(/^Delete its operating directory .*\.$/);
    });
});
