import { describe, expect, it } from 'vitest';
import { childPath, describeValue, inlinePreview, lazy, truncateString } from './json_model';

describe('describeValue', () => {
    it('counts object keys and array items, with serialized size', () => {
        expect(describeValue({ a: 1, b: 'xy' })).toMatchObject({ kind: 'object', count: 2, size: 16, lazy: false });
        expect(describeValue([1, 2, 3])).toMatchObject({ kind: 'array', count: 3, size: 7 });
    });
    it('treats scalars and null as leaves', () => {
        expect(describeValue(null).kind).toBe('null');
        expect(describeValue('s').kind).toBe('string');
        expect(describeValue(1).kind).toBe('number');
        expect(describeValue(true).kind).toBe('boolean');
    });
    it('reads lazy placeholders without needing the data', () => {
        expect(describeValue(lazy({ kind: 'array', count: 48, size: 3174 }))).toEqual({ kind: 'array', count: 48, size: 3174, lazy: true });
    });
});

describe('truncateString', () => {
    it('leaves strings up to the limit alone', () => {
        expect(truncateString('a'.repeat(120))).toEqual({ text: 'a'.repeat(120), truncated: false });
    });
    it('cuts at 120 chars', () => {
        expect(truncateString('a'.repeat(121))).toEqual({ text: 'a'.repeat(120), truncated: true });
    });
});

describe('childPath', () => {
    it('builds stable JSON-path keys', () => {
        expect(childPath('$', 'a')).toBe('$.a');
        expect(childPath('$.a', 0)).toBe('$.a[0]');
        expect(childPath('$', 'we ird')).toBe('$["we ird"]');
    });
});

describe('inlinePreview', () => {
    it('scalars', () => {
        expect(inlinePreview('x')).toBe('"x"');
        expect(inlinePreview(null)).toBe('null');
        expect(inlinePreview(3)).toBe('3');
    });
    it('flat containers, compact', () => {
        expect(inlinePreview({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
        expect(inlinePreview([])).toBe('[]');
    });
    it('cuts to the budget with "… N more"', () => {
        const p = inlinePreview(Array.from({ length: 48 }, () => 'evening'), 40)!;
        expect(p).toMatch(/^\["evening","evening"[^\]]*, … \d+ more\]$/);
    });
    it('always shows at least one member', () => expect(inlinePreview(['x'.repeat(200), 'y'], 10)).toMatch(/^\["x+", … 1 more\]$/));
    it('null (needs a tree) for nested containers and lazy placeholders', () => {
        expect(inlinePreview({ a: { b: 1 } })).toBeNull();
        expect(inlinePreview([[1]])).toBeNull();
        expect(inlinePreview(lazy({ kind: 'array', count: 1, size: 9 }))).toBeNull();
    });
});
