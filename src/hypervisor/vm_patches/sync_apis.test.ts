import "../hypervisor";
import { current } from "../current";
import { patchModule } from "./index";
import { _internals, calledFromAppCode } from "./sync_apis";

describe("calledFromAppCode", () => {
    const frame = (f: string) => `Error\n    at wrapped (${__filename}:1:1)\n    at fn (${f}:10:5)`;

    it("flags app files", () => {
        expect(calledFromAppCode(frame("/config/apps/foo.ts"))).toBe(true);
    });
    it("ignores node_modules callers", () => {
        expect(calledFromAppCode(frame("/config/node_modules/dep/index.js"))).toBe(false);
    });
    it("ignores builtin frames and finds the next caller", () => {
        expect(calledFromAppCode(`Error\n    at x (node:internal/fs:1:1)\n    at fn (/config/apps/foo.ts:10:5)`)).toBe(true);
    });
});

describe("sync api patch", () => {
    afterEach(() => jest.restoreAllMocks());

    it("leaves sync APIs alone outside an app context", () => {
        const fs = patchModule("fs", require("fs"));
        expect(typeof fs.readFileSync).toBe("function");
        expect(fs.readFileSync(__filename).length).toBeGreaterThan(0);
    });

    it("throws for app code and respects allow_sync", () => {
        const fs = patchModule("fs", require("fs"));
        const cfg: any = {};
        jest.spyOn(current, "application", "get").mockReturnValue({ app_config: cfg } as any);
        jest.spyOn(_internals, "calledFromAppCode").mockReturnValue(true);

        expect(() => fs.readFileSync(__filename)).toThrow(/allow_sync/);
        expect(() => patchModule("child_process", require("child_process")).execSync("true")).toThrow(/allow_sync/);

        cfg.allow_sync = true;
        expect(fs.readFileSync(__filename).length).toBeGreaterThan(0);
    });

    it("allows calls from non-app callers", () => {
        const fs = patchModule("fs", require("fs"));
        jest.spyOn(current, "application", "get").mockReturnValue({ app_config: {} } as any);
        jest.spyOn(_internals, "calledFromAppCode").mockReturnValue(false);
        expect(fs.readFileSync(__filename).length).toBeGreaterThan(0);
    });
});
