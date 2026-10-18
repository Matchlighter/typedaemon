import "../../test/helpers/mock_hypervisor";

jest.mock("../hypervisor/managed_apps", () => ({ HyperWrapper: Symbol("HyperWrapper") }));

import { autorun, runInAction } from "mobx";

import { useTempDir } from "../../test/helpers/fs";
import { current } from "../hypervisor/current";
import { HyperWrapper } from "../hypervisor/managed_apps";
import { PersistentStorage, SharedStorages } from "../hypervisor/persistent_storage";
import type { Application } from "./application";
import { persistence, persistent } from "./persistence";

/** Minimal stand-in for an Application, wired to `storage` like a real one is by its ApplicationInstance */
class FakeApp {
    constructor(storage: PersistentStorage) {
        this[HyperWrapper] = { persistedStorage: storage };
    }
}
const ApplicationBase = FakeApp as unknown as new (storage: PersistentStorage) => Application;

class App extends ApplicationBase {
    @persistent
    accessor counter = 0;

    @persistent({ id: "custom-key", min_time_to_disk: 0, max_time_to_disk: 1 })
    accessor named = "default";
}

describe("persistence", () => {
    const tmp = useTempDir("td-persistence-");

    let storage: PersistentStorage;

    /** Simulate an app restart: persist the current storage and load a new one from disk */
    async function restart() {
        await storage.dispose();
        storage = new PersistentStorage(tmp.path("app.jkv"));
        await storage.load();
        (current as any).application = { persistedStorage: storage };
        return storage;
    }

    beforeEach(async () => {
        storage = new PersistentStorage(tmp.path("app.jkv"));
        await storage.load();
        (current as any).application = { persistedStorage: storage };
    });

    afterEach(async () => {
        await storage.dispose();
        delete (current as any).application;
        delete (current as any).hypervisor;
    });

    describe("@persistent", () => {
        it("uses the initializer when nothing is stored", () => {
            const app = new App(storage);
            expect(app.counter).toBe(0);
            expect(storage.hasKey("@persistent-counter")).toBe(false);
        });

        it("stores assigned values", () => {
            const app = new App(storage);
            app.counter = 5;
            app.named = "x";
            expect(storage.getValue("@persistent-counter")).toBe(5);
            expect(storage.getValue("custom-key")).toBe("x");
        });

        it("restores values across restarts", async () => {
            const app = new App(storage);
            app.counter = 5;
            app.named = "x";

            await restart();

            const app2 = new App(storage);
            expect(app2.counter).toBe(5);
            expect(app2.named).toBe("x");
        });

        it("is observable", () => {
            const app = new App(storage);
            const seen = [];
            const dispose = autorun(() => seen.push(app.counter));
            runInAction(() => app.counter = 1);
            runInAction(() => app.counter = 2);
            dispose();
            expect(seen).toEqual([0, 1, 2]);
        });
    });

    describe("app API", () => {
        it("sets, gets, checks and deletes keys", () => {
            expect(persistence.has("k")).toBe(false);
            persistence.set("k", { a: 1 });
            expect(persistence.has("k")).toBe(true);
            expect(persistence.get("k")).toEqual({ a: 1 });
            persistence.delete("k");
            expect(persistence.has("k")).toBe(false);
            expect(persistence.get("k")).toBeUndefined();
        });

        it("persists across restarts", async () => {
            persistence.set("kept", 1);
            persistence.set("deleted", 2);
            persistence.delete("deleted");

            await restart();

            expect(persistence.get("kept")).toBe(1);
            expect(persistence.has("deleted")).toBe(false);
        });
    });

    describe("shared namespaces", () => {
        let shared: SharedStorages;

        beforeEach(async () => {
            shared = new SharedStorages(tmp.path());
            await shared.initialize();
            (current as any).hypervisor = { sharedStorages: shared };
        });

        afterEach(async () => {
            await shared.dispose();
        });

        it("are separate from app storage", async () => {
            persistence.shared.set("k", "shared");
            persistence.set("k", "app");
            expect(persistence.shared.get("k")).toBe("shared");
            expect(persistence.get("k")).toBe("app");

            const ns = await persistence.load_namespace("other");
            ns.set("k", "other");
            expect(ns.get("k")).toBe("other");
            expect(persistence.shared.get("k")).toBe("shared");
        });

        it("are shared between apps", async () => {
            const ns1 = await persistence.load_namespace("ns");
            ns1.set("k", 1);

            const ns2 = await persistence.load_namespace("ns");
            expect(ns2.get("k")).toBe(1);

            ns2.delete("k");
            expect(ns1.get("k")).toBeUndefined();
        });
    });
});
