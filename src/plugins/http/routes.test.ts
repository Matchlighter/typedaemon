import { HttpRouteRegistry } from "./routes";

describe("HttpRouteRegistry", () => {
    it("lists an app's routes in registration order with unique ids, and announces changes with the app", () => {
        const r = new HttpRouteRegistry();
        const changed = jest.fn();
        r.on("change", changed);
        r.add({ appUuid: "a", kind: "route", method: "GET", path: "/x", handler: "x" });
        r.add({ appUuid: "b", kind: "static", path: "/ui", directory: "/d" });
        r.add({ appUuid: "a", kind: "route", method: "POST", path: "/x", handler: "y" });
        expect(r.list("a").map(i => [i.method, i.handler])).toEqual([["GET", "x"], ["POST", "y"]]);
        expect(new Set([...r.list("a"), ...r.list("b")].map(i => i.id)).size).toBe(3);
        expect(changed.mock.calls).toEqual([["a"], ["b"], ["a"]]);
    });

    it("removes one registration; removing twice is quiet", () => {
        const r = new HttpRouteRegistry();
        const remove = r.add({ appUuid: "a", kind: "route", method: "GET", path: "/x", handler: "x" });
        const changed = jest.fn();
        r.on("change", changed);
        remove(); remove();
        expect(r.list("a")).toEqual([]);
        expect(changed).toHaveBeenCalledTimes(1);
    });
});
