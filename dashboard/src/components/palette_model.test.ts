import { describe, expect, it, vi } from 'vitest';
import { matchRange, moveActive, searchProviders, type PaletteProvider } from './palette_model';

const prov = (id: string, title: string, labels: string[]): PaletteProvider => ({
    id, title,
    search: q => labels.filter(l => matchRange(l, q)).map(l => ({ id: `${id}:${l}`, label: l, run: () => {} })),
});

describe('matchRange', () => {
    it('finds a case-insensitive substring', () => {
        expect(matchRange('sensor.Kitchen_temp', 'kitchen')).toEqual([7, 14]);
    });
    it('highlights the first occurrence', () => {
        expect(matchRange('a_light light', 'light')).toEqual([2, 7]);
        expect(matchRange('light a_light', 'light')).toEqual([0, 5]);
    });
    it('returns null on no match and an empty range for empty query', () => {
        expect(matchRange('abc', 'x')).toBeNull();
        expect(matchRange('abc', '')).toEqual([0, 0]);
    });
});

describe('searchProviders', () => {
    const providers = [prov('e', 'Entities', ['light.a', 'sensor.b']), prov('s', 'Storage keys', ['k1']), prov('a', 'Actions', ['Restart lights'])];
    it('groups by provider in order, dropping empty groups, with a flat list', () => {
        const r = searchProviders(providers, 'l');
        expect(r.groups.map(g => g.title)).toEqual(['Entities', 'Actions']);
        expect(r.flat.map(i => i.label)).toEqual(['light.a', 'Restart lights']);
    });
    it('yields nothing when nothing matches', () => {
        expect(searchProviders(providers, 'zzz').flat).toEqual([]);
    });
    it('isolates a throwing provider', () => {
        const bad: PaletteProvider = { id: 'x', title: 'Bad', search: () => { throw new Error('no'); } };
        const err = vi.spyOn(console, 'error').mockImplementation(() => { });
        expect(searchProviders([bad, ...providers], 'k1').flat.map(i => i.label)).toEqual(['k1']);
        expect(err).toHaveBeenCalledWith('palette provider x failed', expect.any(Error));
        err.mockRestore();
    });
});

describe('moveActive', () => {
    it('wraps both directions across the flat list', () => {
        expect(moveActive(0, 1, 3)).toBe(1);
        expect(moveActive(2, 1, 3)).toBe(0);
        expect(moveActive(0, -1, 3)).toBe(2);
    });
    it('is 0 for an empty list', () => { expect(moveActive(0, 1, 0)).toBe(0); });
});
