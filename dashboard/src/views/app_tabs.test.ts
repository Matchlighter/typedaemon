import type { AppDetail } from '@protocol';
import { describe, expect, it, vi } from 'vitest';
import { appTabs, tabItems, visibleTabKey } from './app_tabs';
vi.mock('../app', () => ({ app: {} }));

const detail = (over: Partial<AppDetail> = {}): AppDetail => ({ row: { id: 'a', name: 'a', source: 'a.ts', state: 'started', since: 0 }, uuid: 'a', instanceOf: 'a.ts#default', packages: {}, watching: true, counts: {}, ...over });

describe('app tabs', () => {
    it('follows the information architecture order', () => {
        expect(appTabs.map(t => t.key)).toEqual(['overview', 'logs', 'entities', 'storage', 'resumables', 'schedules', 'http', 'config']);
    });

    it('falls back to overview for missing/unknown tabs', () => {
        expect(visibleTabKey(undefined)).toBe('overview');
        expect(visibleTabKey('nope')).toBe('overview');
        expect(visibleTabKey('storage')).toBe('storage');
    });

    it('counts come from detail.counts; absent until the source provides them', () => {
        const count = (d: AppDetail, key: string) => tabItems(d).find(t => t.key === key)!.count;
        const d = detail({ counts: { entities: 14, storage: 5, http: 3 } });
        expect(count(d, 'entities')).toBe(14);
        expect(count(d, 'storage')).toBe(5);
        expect(count(d, 'http')).toBe(3);
        expect(count(d, 'schedules')).toBeUndefined();
        expect(count(d, 'logs')).toBeUndefined();
    });

    it('shows … and no unlinked flag while compiling/starting', () => {
        const d = detail({ row: { id: 'a', name: 'a', source: 'a.ts', state: 'compiling', since: 0 }, counts: { entities: 0, unlinkedEntities: 4, storage: 3 } });
        const items = tabItems(d);
        expect(items.find(t => t.key === 'entities')!.count).toBe('…');
        expect(items.find(t => t.key === 'entities')!.flag).toBeUndefined();
        expect(items.find(t => t.key === 'storage')!.count).toBe('…');
        expect(items.find(t => t.key === 'logs')!.count).toBeUndefined();
    });

    it('flags unlinked entities', () => {
        const flag = (d: AppDetail) => tabItems(d).find(t => t.key === 'entities')!.flag;
        expect(flag(detail({ counts: { unlinkedEntities: 2 } }))).toBe('+2 unlinked');
        expect(flag(detail())).toBeUndefined();
    });
});
