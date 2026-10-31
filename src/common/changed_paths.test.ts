import { changedPaths } from "./changed_paths";

describe('changedPaths', () => {
    it('names the deepest differing keys', () => {
        expect(changedPaths({ a: 1, config: { scenes: [1], x: 1 } }, { a: 1, config: { scenes: [2], x: 1 } })).toEqual(['config.scenes']);
    });
    it('covers added and removed keys', () => {
        expect(changedPaths({ a: 1 }, { b: 2 })).toEqual(['a', 'b']);
    });
    it('is empty when equal', () => {
        expect(changedPaths({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
    });
});
