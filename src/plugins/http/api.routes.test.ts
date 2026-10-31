import { EventEmitter } from "events";
import * as path from "path";

const cleanups: (() => any)[] = [];
const mockApp = { uuid: "u-1", source_directory: "/w/apps/lights", cleanups: { append: (f: () => any) => { cleanups.push(f) } }, invoke: (f: () => any) => f() };
jest.mock("../../hypervisor/current", () => ({ current: { get application() { return mockApp } } }));
jest.mock("../base", () => ({
    assert_application_context: jest.fn(),
    bind_callback_env: jest.fn((cb) => cb),
    getOrCreateLocalData: (_p: any, _a: any, _k: any, build: any) => (mockApp as any).store ??= build(_p, _a),
    handle_client_error: jest.fn(),
    makeApiExport: jest.fn(),
    notePluginAnnotation: jest.fn(),
}));

import { httpApi } from "./api";
import { HttpRouteRegistry } from "./routes";

let routes: HttpRouteRegistry, plugin: any, http: ReturnType<typeof httpApi>;
beforeEach(() => {
    cleanups.length = 0;
    delete (mockApp as any).store;
    routes = new HttpRouteRegistry();
    plugin = { routes, registerAppStore: jest.fn(), unregisterAppStore: jest.fn() };
    http = httpApi(plugin);
});

describe("routes an app registers are recorded for the dashboard", () => {
    it("records method, path and handler name; bound methods keep the method's name", () => {
        http.handle.get("/scenes")(function list_scenes() { });
        const holder = { save() { } };
        http.handle.post("/scenes")(holder.save.bind(holder));
        http.handle("PUT", "/scenes")(function replace() { });
        http.handle.all("/any")(function any_of_them() { });
        expect(routes.list("u-1")).toEqual([
            expect.objectContaining({ kind: "route", method: "GET", path: "/scenes", handler: "list_scenes" }),
            expect.objectContaining({ kind: "route", method: "POST", path: "/scenes", handler: "save" }),
            expect.objectContaining({ kind: "route", method: "PUT", path: "/scenes", handler: "replace" }),
            expect.objectContaining({ kind: "route", method: "ALL", path: "/any", handler: "any_of_them" }),
        ]);
    });

    it("records static mounts with their absolute directory", () => {
        http.serve_static("/ui", "www");
        expect(routes.list("u-1")).toEqual([expect.objectContaining({ kind: "static", path: "/ui", directory: path.resolve("/w/apps/lights", "www") })]);
    });

    it("forgets the app's routes when the app cleans up (restart)", async () => {
        http.handle.get("/a")(function a() { });
        const changed = jest.fn();
        routes.on("change", changed);
        for (const c of cleanups) await c();
        expect(routes.list("u-1")).toEqual([]);
        expect(changed).toHaveBeenCalled();
    });

    it("keeps other apps' routes apart", () => {
        http.handle.get("/a")(function a() { });
        expect(routes.list("other")).toEqual([]);
    });
});
