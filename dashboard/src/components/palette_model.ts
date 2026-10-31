import type { ReactNode } from 'react';

export interface PaletteResult {
    id: string;
    /** Mono primary text; the matched substring is highlighted. */
    label: string;
    /** Right-aligned muted text (owner app / state / "app action") */
    sublabel?: string;
    /** Rich replacement for the label (e.g. "Restart <b>lights</b>"); not highlighted. */
    content?: ReactNode;
    /** Invoked on Enter/click; palette closes afterwards. */
    run(): void;
}

/** A pluggable result source. `search` must be synchronous and cheap; use substring/prefix matching (`matchRange`). */
export interface PaletteProvider {
    id: string;
    /** Group header, e.g. "Entities" */
    title: string;
    search(query: string): PaletteResult[];
}

export interface PaletteGroup { id: string; title: string; items: PaletteResult[] }
export interface PaletteSearch { groups: PaletteGroup[]; flat: PaletteResult[] }

/** Case-insensitive substring match, [start, end) of the first occurrence, or null. Empty query matches everything. */
export function matchRange(text: string, query: string): [number, number] | null {
    if (!query) return [0, 0];
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    return i < 0 ? null : [i, i + query.length];
}

export function searchProviders(providers: PaletteProvider[], query: string): PaletteSearch {
    const groups: PaletteGroup[] = [];
    for (const p of providers) {
        let items: PaletteResult[] = [];
        try { items = p.search(query); } catch (e) { console.error(`palette provider ${p.id} failed`, e); }
        if (items.length) groups.push({ id: p.id, title: p.title, items });
    }
    return { groups, flat: groups.flatMap(g => g.items) };
}

/** Next active index, wrapping. */
export function moveActive(current: number, delta: 1 | -1, count: number) {
    return count === 0 ? 0 : (current + delta + count) % count;
}
