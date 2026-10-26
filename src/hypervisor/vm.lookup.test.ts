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
