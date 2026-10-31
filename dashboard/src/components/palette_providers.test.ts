import type { AppRow, GlobalEntityRow, StorageRow } from '@protocol';
import { describe, expect, it, vi } from 'vitest';
import { actionsProvider, appsProvider, entitiesProvider, storageProvider, type PaletteNav } from './palette_providers';

const nav = (): PaletteNav & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return { calls, go: (path, focus) => { calls.push([path, focus]); } };
};
const app = (id: string, state: AppRow['state'] = 'started'): AppRow => ({ id, name: id, source: `${id}.ts`, state, since: 0 } as AppRow);
const ent = (o: Partial<GlobalEntityRow>): GlobalEntityRow => ({ key: 'ha:1', plugin: 'ha', domain: 'light', entityId: 'light.kitchen', linked: true, autoClean: false, persistState: false, app: 'lights', entityKey: '1', ...o } as GlobalEntityRow);

describe('appsProvider', () => {
    it('matches by id/name and navigates to the app', () => {
        const n = nav();
        const items = appsProvider(() => [app('lights'), app('heating')], n).search('light');
        expect(items.map(i => i.label)).toEqual(['lights']);
        items[0].run();
        expect(n.calls).toEqual([['/apps/lights', undefined]]);
    });
});

describe('entitiesProvider', () => {
    it('opens the entity page, orphan or not', () => {
        const n = nav();
        const [it1] = entitiesProvider(() => [ent({ key: 'lights/ha:1' }), ent({ key: 'gone/ha:1', orphan: true })], n).search('kitchen');
        expect(it1.sublabel).toBe('lights');
        it1.run();
        entitiesProvider(() => [ent({ key: 'gone/ha:1', orphan: true })], n).search('kitchen')[0].run();
        expect(n.calls.map(c => c[0])).toEqual(['/entities/lights%2Fha%3A1', '/entities/gone%2Fha%3A1']);
    });
    it('caps results', () => {
        const rows = Array.from({ length: 30 }, (_, i) => ent({ key: `k${i}`, entityId: `light.l${i}` }));
        expect(entitiesProvider(() => rows, nav()).search('light.')).toHaveLength(8);
    });
});

describe('storageProvider', () => {
    it('searches app/key and focuses the key row', () => {
        const n = nav();
        const rows: StorageRow[] = [{ key: 'counter', size: 1, writtenAt: 0, internal: false }];
        const items = storageProvider(() => ({ lights: rows, other: [] }), n).search('lights/cou');
        expect(items.map(i => i.label)).toEqual(['lights/counter']);
        items[0].run();
        expect(n.calls).toEqual([['/apps/lights/storage', '[data-row-key="counter"]']]);
    });
    it('hides internal keys', () => {
        const rows: StorageRow[] = [{ key: '__x', size: 1, writtenAt: 0, internal: true }];
        expect(storageProvider(() => ({ a: rows }), nav()).search('')).toEqual([]);
    });
});

describe('actionsProvider', () => {
    it('offers state-appropriate actions and delegates to the requester', () => {
        const request = vi.fn();
        const p = actionsProvider(() => [app('lights'), app('off', 'stopped')], request);
        expect(p.search('').map(i => i.label)).toEqual(['Restart lights', 'Stop lights', 'Start off']);
        p.search('stop lights')[0].run();
        expect(request).toHaveBeenCalledWith('lights', 'stop');
    });
});
