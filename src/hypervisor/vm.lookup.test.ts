import { injectModuleLookupPaths } from "./vm";

describe("injectModuleLookupPaths", () => {
    const dirs = { appModules: "/cfg/.typedaemon/src/app/node_modules", configModules: "/cfg/node_modules" };

    test("app deps resolve first, pre-installed config packages as a fallback", () => {
        expect(injectModuleLookupPaths(["/elsewhere/node_modules", "/node_modules"], dirs)).toEqual([
            "/cfg/.typedaemon/src/app/node_modules",
            "/elsewhere/node_modules",
            "/node_modules",
            "/cfg/node_modules",
        ]);
    });

    test("does not duplicate paths already in the lookup chain", () => {
        expect(injectModuleLookupPaths(["/cfg/.typedaemon/src/app/node_modules", "/cfg/node_modules", "/node_modules"], dirs)).toEqual([
            "/cfg/.typedaemon/src/app/node_modules",
            "/cfg/node_modules",
            "/node_modules",
        ]);
    });
});

import { determineModuleContext, packageNameOf } from "./vm";

describe("hosted packages", () => {
    test("packageNameOf uses the innermost node_modules and handles scopes", () => {
        expect(packageNameOf("/cfg/node_modules/lodash/index.js")).toBe("lodash");
        expect(packageNameOf("/cfg/node_modules/@scope/pkg/lib/a.js")).toBe("@scope/pkg");
        expect(packageNameOf("/cfg/node_modules/a/node_modules/b/x.js")).toBe("b");
        expect(packageNameOf("/cfg/app.ts")).toBeUndefined();
    });

    test("hosted packages load in the host; others in the sandbox", () => {
        const file = "/cfg/node_modules/sqlite3/lib/index.js";
        expect(determineModuleContext(file)).toBe("sandbox");
        expect(determineModuleContext(file, ["sqlite3"])).toBe("host");
        expect(determineModuleContext(file, [/^sql/])).toBe("host");
        expect(determineModuleContext(file, ["sqlite"])).toBe("sandbox");
        expect(determineModuleContext("/cfg/app.ts", ["sqlite3"])).toBe("sandbox");
    });
});
