import type { script as scriptT } from ".";

// Type-level test: checked by `tsc -p tsconfig.types-test.json` (ts-jest runs isolatedModules, so jest doesn't typecheck).
// Never invoked, and `script` is type-only, to avoid pulling the hypervisor import cycle into jest.
declare const script: typeof scriptT;

function _typecheckOnly() {
    class Sample {
        @script({ mode: "single" })
        async run(at: number): Promise<void> { }
    }
    return Sample;
}

describe("script decorator typing", () => {
    it("accepts async methods (no TS1270)", () => {
        expect(_typecheckOnly).toBeDefined();
    });
});
