/**
 * Register a type-level test. The body is never meaningfully executed - its assertions (`@ts-expect-error`, assignments)
 * are checked by `yarn test:types` (tsconfig.types-test.json), since ts-jest runs with isolatedModules and doesn't typecheck.
 *
 * Import units under test type-only (`import type` / `typeof import()`) plus `declare const`, to avoid runtime import cycles.
 */
export function typeTest(name: string, body: () => void) {
    it(name, () => {
        expect(body).toBeDefined();
    });
}
