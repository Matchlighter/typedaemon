import { configLine, defaultPaths } from './config_provenance';

describe('defaultPaths', () => {
    it('lists the highest paths whose value the file did not give', () => {
        const resolved = { source: '/x/a.ts', export: null, logging: { level: 'info', file: 'f' }, watch: { source: false }, config: { a: 1 } };
        const raw = { source: 'a.ts', logging: { file: 'f' }, config: { a: 1 } };
        expect(defaultPaths(resolved, raw)).toEqual([['export'], ['logging', 'level'], ['watch']]);
    });

    it('treats everything as default when the file has no raw config, and values the file gave as not', () => {
        expect(defaultPaths({ a: { b: 1 } }, undefined)).toEqual([['a']]);
        expect(defaultPaths({ a: 1, b: [1, 2] }, { a: 1, b: [3] })).toEqual([]);
    });

    it('does not descend into arrays', () => {
        expect(defaultPaths({ l: [{ x: 1 }] }, {})).toEqual([['l']]);
    });
});

describe('configLine', () => {
    const yaml = ['daemon:', '  watch: {}', 'apps:', '  lights:', '    source: a.ts', '  other:', '    source: b.ts'].join('\n');
    it('finds the 1-based line of the app key under `apps`', () => {
        expect(configLine(yaml, 'other')).toBe(6);
        expect(configLine(yaml, 'lights')).toBe(4);
    });
    it('is undefined when it cannot be found', () => {
        expect(configLine(yaml, 'nope')).toBeUndefined();
        expect(configLine('lights: 1', 'lights')).toBeUndefined();
    });
    it('handles quoted keys (json/js)', () => {
        expect(configLine('{\n "apps": {\n  "lights": {}\n }\n}', 'lights')).toBe(3);
    });
});
