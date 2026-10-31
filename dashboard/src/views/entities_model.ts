import { applyKeyedDelta } from './keyed_rows';
import type { EntityRow, GlobalEntityRow, KeyedDelta } from '@protocol';

export type EntitySegment = 'all' | 'linked' | 'unlinked';
export const ENTITY_SEGMENTS: EntitySegment[] = ['all', 'linked', 'unlinked'];
export const ENTITY_SEGMENT_LABEL: Record<EntitySegment, string> = { all: 'All', linked: 'Linked', unlinked: 'Unlinked' };

/** Fold an `appEntities` topic delta into the snapshot */
export const applyEntitiesDelta = <R extends EntityRow>(cur: { rows: R[] }, d: KeyedDelta<R>): { rows: R[] } => ({ rows: applyKeyedDelta(cur.rows, d) });

/** HA's entity_id once known; HA assigns it after TypeDaemon publishes the entity */
export const displayEntityId = (r: EntityRow) => r.entityId ?? `${r.domain}.(unresolved)`;

/** `displayEntityId` for running text: an entity HA hasn't resolved is worded as such instead of as a fake entity_id */
export const entityLabel = (r: EntityRow) => r.entityId ?? `${r.domain} entity (not resolved in HA)`;

/** Narrowing of an entity list; every part is optional and they all apply together */
export interface EntityFilter {
    segment?: EntitySegment;
    /** Only rows of this app (global list) */
    app?: string;
    domain?: string;
    /** Case-insensitive text in the entity id or name */
    query?: string;
}
type Dimension = keyof EntityFilter;

const matchers: { [D in Dimension]: (r: GlobalEntityRow, v: NonNullable<EntityFilter[D]>) => boolean } = {
    segment: (r, v) => v === 'all' || (v === 'linked') === r.linked,
    app: (r, v) => r.app === v,
    domain: (r, v) => r.domain === v,
    query: (r, v) => (displayEntityId(r) + ' ' + (r.name ?? '')).toLowerCase().includes(v.toLowerCase()),
};

/** Rows matching `filter` (ignoring the `except` dimension) */
function matching<R extends EntityRow>(rows: R[], filter: EntityFilter, except?: Dimension): R[] {
    return rows.filter(r => (Object.keys(matchers) as Dimension[]).every(d =>
        d === except || filter[d] === undefined || filter[d] === '' || (matchers[d] as any)(r, filter[d])));
}

/** Filtered, sorted by displayed id so rows don't jump while states change */
export function filterEntities<R extends EntityRow>(rows: R[], filter: EntityFilter): R[] {
    return matching(rows, filter)
        .sort((a, b) => displayEntityId(a).localeCompare(displayEntityId(b)) || a.key.localeCompare(b.key));
}

export function entitySegmentCounts(rows: EntityRow[]): Record<EntitySegment, number> {
    const linked = rows.filter(r => r.linked).length;
    return { all: rows.length, linked, unlinked: rows.length - linked };
}

export interface FacetOption { value: string; count: number; /** App no longer in config */ orphan?: boolean }

/** What each filter control offers and how many rows each choice would show, given the other filters (not its own) */
export function entityFacets(rows: GlobalEntityRow[], filter: EntityFilter) {
    const options = (pick: (r: GlobalEntityRow) => string, except: Dimension, orphaned?: (r: GlobalEntityRow) => boolean): FacetOption[] => {
        const counts = new Map<string, number>();
        const orphans = new Set<string>();
        for (const r of rows) { counts.set(pick(r), 0); if (orphaned?.(r)) orphans.add(pick(r)) }
        for (const r of matching(rows, filter, except)) counts.set(pick(r), counts.get(pick(r))! + 1);
        return [...counts].map(([value, count]) => orphans.has(value) ? { value, count, orphan: true } : { value, count }).sort((a, b) => a.value.localeCompare(b.value));
    };
    return {
        segments: entitySegmentCounts(matching(rows, filter, 'segment')),
        apps: options(r => r.app, 'app', r => !!r.orphan),
        domains: options(r => r.domain, 'domain'),
    };
}

/** "3 unlinked belong to orphan x": unlinked rows of apps no longer in config, which are cleaned up from the orphan's page. Undefined when none. */
export function orphanUnlinkedHint(rows: GlobalEntityRow[]): string | undefined {
    const orphans = new Set<string>();
    let n = 0;
    for (const r of rows) if (r.orphan && !r.linked) { n++; orphans.add(r.app) }
    if (!n) return undefined;
    return orphans.size === 1
        ? `${n} unlinked belong to orphan ${[...orphans][0]} — cleaning up the orphan removes them all at once.`
        : `${n} unlinked belong to ${orphans.size} orphans — cleaning up an orphan removes its own all at once.`;
}
