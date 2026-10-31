import { describe, expect, it } from 'vitest';
import { dash, formatBytes, formatDuration, plural } from './format';

describe('formatBytes', () => {
    it.each([[0, '0 B'], [512, '512 B'], [1024, '1.0 KB'], [3174, '3.1 KB'], [5 * 1024 * 1024, '5.0 MB']])('%i -> %s', (n, s) => {
        expect(formatBytes(n)).toBe(s);
    });
});

describe('plural', () => {
    it('counts with the singular for exactly one', () => {
        expect(plural(1, 'file')).toBe('1 file');
        expect(plural(0, 'file')).toBe('0 files');
        expect(plural(2, 'entity', 'entities')).toBe('2 entities');
        expect(plural(1, 'entity', 'entities')).toBe('1 entity');
    });
});

describe('dash', () => {
    it('shows a dash for null/undefined only', () => {
        expect(dash(undefined)).toBe('—');
        expect(dash(null)).toBe('—');
        expect(dash(0)).toBe('0');
        expect(dash('')).toBe('');
        expect(dash('x')).toBe('x');
    });
});

describe("formatDuration", () => {
    it.each([[0, "0s"], [42_000, "42s"], [468_000, "7m 48s"], [8_040_000, "2h 14m"], [3 * 86400_000 + 4 * 3600_000, "3d 4h"]])("%i -> %s", (n, s) => {
        expect(formatDuration(n)).toBe(s);
    });
});
