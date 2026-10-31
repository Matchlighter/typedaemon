import "../../test/helpers/mock_hypervisor";

// Allow observing FileHandles (for fsync)
jest.mock("fs/promises", () => {
    const actual = jest.requireActual("fs/promises");
    return { ...actual, open: jest.fn(actual.open) };
});

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

import { useTempDir } from "../../test/helpers/fs";
import { PersistentEntryOptions, PersistentStorage, SharedStorages, StorageChange, isInternalStorageKey, registerInternalKeyPrefix } from "./persistent_storage";

const policy = (min_time_to_disk: number, max_time_to_disk: number): PersistentEntryOptions => ({ min_time_to_disk, max_time_to_disk });
const IMMEDIATE = policy(0, 0);
const OPTS = IMMEDIATE;
const LATER = policy(3600, 3600);

describe("PersistentStorage", () => {
    const tmp = useTempDir("td-persist-");
    const FILE = "store.jkv";

    const storages: PersistentStorage[] = [];
    function storage() {
        const s = new PersistentStorage(tmp.path(FILE));
        storages.push(s);
        return s;
    }

    /** Simulate a restart, crashed or otherwise - a fresh store loaded from whatever is on disk */
    async function reload() {
        const s = storage();
        await s.load();
        return s;
    }

    function journal() {
        if (!tmp.exists(FILE)) return [];
        return tmp.read(FILE).split("\n").filter(Boolean).map(line => {
            const i = line.indexOf(" ");
            return [line.slice(0, i), JSON.parse(line.slice(i + 1))];
        });
    }

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
    });

    afterEach(async () => {
        jest.useRealTimers();
        for (let s of storages.splice(0)) {
            await s.dispose();
        }
    });

    describe("in-memory API", () => {
        it("gets, sets and checks keys", () => {
            const s = storage();
            expect(s.hasKey("a")).toBe(false);
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("b", { x: 1 }, IMMEDIATE);
            expect(s.getValue("a")).toBe(1);
            expect(s.getValue("b")).toEqual({ x: 1 });
            expect(s.hasKey("a")).toBe(true);
            expect(s.keys.sort()).toEqual(["a", "b"]);
        });

        it("deletes keys set to undefined", () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("a", undefined, IMMEDIATE);
            expect(s.hasKey("a")).toBe(false);
            expect(s.keys).toEqual([]);
        });

        it("sets and deletes object sub-keys", () => {
            const s = storage();
            s.objectSet("o", "a", 1, IMMEDIATE);
            s.objectSet("o", "b", 2, IMMEDIATE);
            s.objectSet("o", "a", undefined, IMMEDIATE);
            expect(s.getValue("o")).toEqual({ b: 2 });
        });

        it("pushes to and pops from arrays", () => {
            const s = storage();
            s.arrayPush("arr", 1, IMMEDIATE);
            s.arrayPush("arr", 2, IMMEDIATE);
            s.arrayPush("arr", 3, IMMEDIATE);
            s.arrayPush("arr", 0, IMMEDIATE, 0);
            expect(s.getValue("arr")).toEqual([0, 1, 2, 3]);

            s.arrayPop("arr", IMMEDIATE);
            expect(s.getValue("arr")).toEqual([0, 1, 2]);
            s.arrayPop("arr", IMMEDIATE, 0);
            expect(s.getValue("arr")).toEqual([1, 2]);
        });

        it("refuses modification after disposal", async () => {
            const s = storage();
            await s.dispose();
            expect(() => s.setValue("a", 1, IMMEDIATE)).toThrow(/after disposal/);
        });
    });

    describe("journaling", () => {
        it("journals SETs as MRG and deletions as DEL", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("b", "two", IMMEDIATE);
            s.setValue("gone", true, IMMEDIATE);
            await s.flushToDisk(true);
            s.setValue("gone", undefined, IMMEDIATE);
            await s.flushToDisk(true);

            expect(journal()).toEqual([
                ["MRG", { a: 1, b: "two", gone: true }],
                ["DEL", ["gone"]],
            ]);
        });

        it("journals object and array operations as OSET and ASPLC", async () => {
            const s = storage();
            s.objectSet("o", "k", 1, IMMEDIATE);
            s.arrayPush("arr", "x", IMMEDIATE);
            await s.flushToDisk(true);

            expect(journal().map(([cmd]) => cmd)).toEqual(["OSET", "ASPLC"]);
        });

        it("coalesces repeated SETs of a key into a single write", async () => {
            const s = storage();
            for (let i = 0; i < 5; i++) s.setValue("a", i, IMMEDIATE);
            await s.flushToDisk(true);

            expect(journal()).toEqual([["MRG", { a: 4 }]]);
        });

        it("writes nothing when nothing changed", async () => {
            const s = storage();
            await s.flushToDisk(true);
            expect(journal()).toEqual([]);
        });

        it("still writes a value that was set twice in a row", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);

            expect((await reload()).getValue("a")).toBe(1);
        });

        it("skips writing a value that was reverted before being flushed", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);

            s.setValue("a", 2, IMMEDIATE);
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);

            expect(journal()).toEqual([["MRG", { a: 1 }]]);
        });

        it("does not lose an intermediate value when reverting to an unflushed value", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("a", 2, IMMEDIATE);
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);

            expect((await reload()).getValue("a")).toBe(1);
        });

        it("fsyncs after writing", async () => {
            const realOpen = jest.requireActual("fs/promises").open;
            const syncs: jest.Mock[] = [];
            jest.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
                const handle = await realOpen(...args);
                const sync = jest.fn(handle.sync.bind(handle));
                handle.sync = sync;
                syncs.push(sync);
                return handle;
            });

            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);

            expect(syncs).toHaveLength(1);
            expect(syncs[0]).toHaveBeenCalledTimes(1);
        });
    });

    describe("write scheduling", () => {
        /** Capture timer-triggered flushes so that their I/O can be awaited */
        function trackFlushes(s: PersistentStorage) {
            const spy = jest.spyOn(s, "flushToDisk");
            return {
                get count() { return spy.mock.calls.length },
                settled: () => Promise.all(spy.mock.results.map(r => r.value)),
            }
        }

        it("does not write before min_time_to_disk", async () => {
            const s = storage();
            const flushes = trackFlushes(s);
            s.setValue("a", 1, policy(1, 3));

            await jest.advanceTimersByTimeAsync(900);
            await flushes.settled();

            expect(flushes.count).toBe(0);
            expect(journal()).toEqual([]);
        });

        it("writes by max_time_to_disk", async () => {
            const s = storage();
            const flushes = trackFlushes(s);
            s.setValue("a", 1, policy(1, 3));

            await jest.advanceTimersByTimeAsync(3000);
            await flushes.settled();

            expect(flushes.count).toBe(1);
            expect(journal()).toEqual([["MRG", { a: 1 }]]);
        });

        it("batches entries that are past min_time_to_disk into the next due write", async () => {
            const s = storage();
            const flushes = trackFlushes(s);
            s.setValue("lazy", 1, policy(1, 60));
            s.setValue("urgent", 2, policy(1, 3));

            await jest.advanceTimersByTimeAsync(3000);
            await flushes.settled();

            expect(journal()).toEqual([["MRG", { lazy: 1, urgent: 2 }]]);
        });

        it("defers entries that are not yet past min_time_to_disk", async () => {
            const s = storage();
            const flushes = trackFlushes(s);
            s.setValue("urgent", 1, policy(0, 1));
            s.setValue("lazy", 2, policy(5, 60));

            await jest.advanceTimersByTimeAsync(1000);
            await flushes.settled();
            expect(journal()).toEqual([["MRG", { urgent: 1 }]]);

            await jest.advanceTimersByTimeAsync(60_000);
            await flushes.settled();
            expect(journal()).toEqual([["MRG", { urgent: 1 }], ["MRG", { lazy: 2 }]]);
        });

        it("flushes everything when forced", async () => {
            const s = storage();
            s.setValue("a", 1, policy(30, 60));
            await s.flushToDisk(true);
            expect(journal()).toEqual([["MRG", { a: 1 }]]);
        });
    });

    describe("compaction", () => {
        it("squashes the journal into a single SET on dispose", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            await s.flushToDisk(true);
            s.setValue("b", 2, IMMEDIATE);
            s.objectSet("o", "k", "v", IMMEDIATE);
            s.setValue("a", undefined, IMMEDIATE);
            await s.flushToDisk(true);

            await s.dispose();

            expect(journal()).toEqual([["SET", { b: 2, o: { k: "v" } }]]);
            expect(tmp.exists(FILE + ".tmp")).toBe(false);
        });

        it("does not rewrite an unmodified store", async () => {
            tmp.write(FILE, `MRG {"a":1}\nMRG {"b":2}\n`);
            const s = await reload();
            await s.dispose();
            expect(tmp.read(FILE)).toBe(`MRG {"a":1}\nMRG {"b":2}\n`);
        });

        it("continues journaling after compaction", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            await s.fullWriteToDisk();
            s.setValue("b", 2, IMMEDIATE);
            await s.flushToDisk(true);

            expect(journal()).toEqual([["SET", { a: 1 }], ["MRG", { b: 2 }]]);
        });

        it("does not re-apply operations already captured by compaction", async () => {
            const s = storage();
            s.arrayPush("arr", 1, policy(30, 60));
            await s.fullWriteToDisk();
            await s.flushToDisk(true);

            expect((await reload()).getValue("arr")).toEqual([1]);
        });
    });

    describe("recovery", () => {
        it("does nothing when there is no file", async () => {
            const s = await reload();
            expect(s.keys).toEqual([]);
        });

        it("replays a journal written by a session that never compacted (eg. crashed)", async () => {
            const s = storage();
            s.setValue("a", 1, IMMEDIATE);
            s.setValue("b", 2, IMMEDIATE);
            s.setValue("nil", null, IMMEDIATE);
            await s.flushToDisk(true);
            s.setValue("b", undefined, IMMEDIATE);
            s.objectSet("o", "x", 1, IMMEDIATE);
            s.objectSet("o", "y", 2, IMMEDIATE);
            s.objectSet("o", "x", undefined, IMMEDIATE);
            s.arrayPush("arr", 1, IMMEDIATE);
            s.arrayPush("arr", 2, IMMEDIATE);
            s.arrayPop("arr", IMMEDIATE, 0);
            await s.flushToDisk(true);

            const r = await reload();
            expect(r.keys.sort()).toEqual(["a", "arr", "nil", "o"]);
            expect(r.getValue("a")).toBe(1);
            expect(r.getValue("nil")).toBeNull();
            expect(r.getValue("o")).toEqual({ y: 2 });
            expect(r.getValue("arr")).toEqual([2]);
        });

        it("replays each instruction type", async () => {
            tmp.write(FILE, [
                `SET {"a":1,"b":2,"c":3}`,
                `MRG {"b":20,"d":4}`,
                `DEL ["c"]`,
                `OSET {"key":"o","subkey":"k","value":"v"}`,
                `ASPLC {"key":"arr","values":[1,2]}`,
                ``,
            ].join("\n"));

            const r = await reload();
            expect(Object.fromEntries(r.keys.map(k => [k, r.getValue(k)]))).toEqual({
                a: 1, b: 20, d: 4, o: { k: "v" }, arr: [1, 2],
            });
        });

        it("SET replaces the whole store", async () => {
            tmp.write(FILE, `MRG {"a":1}\nSET {"b":2}\n`);
            const r = await reload();
            expect(r.keys).toEqual(["b"]);
        });

        it("ignores a partially-written trailing line", async () => {
            tmp.write(FILE, `MRG {"a":1}\nMRG {"b":2}\nMRG {"c":`);
            const r = await reload();
            expect(r.getValue("a")).toBe(1);
            expect(r.getValue("b")).toBe(2);
            expect(r.hasKey("c")).toBe(false);
        });

        it("refuses to load a journal corrupted before its last line", async () => {
            tmp.write(FILE, `MRG {"a":1}\nMRG {garbage\nMRG {"b":2}\n`);
            await expect(reload()).rejects.toThrow();
        });

        it("round-trips through a clean shutdown", async () => {
            const s = storage();
            s.setValue("a", { deep: [1, { x: "y" }] }, policy(30, 60));
            s.objectSet("o", "k", 1, policy(30, 60));
            await s.dispose();

            const r = await reload();
            expect(r.getValue("a")).toEqual({ deep: [1, { x: "y" }] });
            expect(r.getValue("o")).toEqual({ k: 1 });
        });
    });
});

describe("SharedStorages", () => {
    const tmp = useTempDir("td-shared-");

    it("loads each namespace once, from <root>/<name>.jkv", async () => {
        tmp.write("other.jkv", `SET {"a":1}\n`);

        const shared = new SharedStorages(tmp.dir);
        await shared.initialize();

        const other = await shared.load("other");
        expect(await shared.load("other")).toBe(other);
        expect(other.getValue("a")).toBe(1);
        expect(shared.primary.file_path).toBe(tmp.path("default.jkv"));

        await shared.dispose();
    });

    it("persists every namespace on dispose", async () => {
        const shared = new SharedStorages(tmp.dir);
        await shared.initialize();
        shared.primary.setValue("p", 1, IMMEDIATE);
        (await shared.load("other")).setValue("o", 2, IMMEDIATE);
        await shared.dispose();

        expect(tmp.read("default.jkv")).toBe(`SET {"p":1}\n`);
        expect(tmp.read("other.jkv")).toBe(`SET {"o":2}\n`);
    });

    it("emits changes from loaded stores and lists them", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-shared-"));
        const shared = new SharedStorages(dir);
        await shared.initialize();
        const seen: [string, StorageChange][] = [];
        shared.on("change", (name, e) => seen.push([name, e]));
        const other = await shared.load("other");
        other.setValue("k", 1, LATER);
        shared.primary.setValue("p", 2, LATER);
        expect(shared.list().sort()).toEqual(["default", "other"]);
        expect(seen.map(([n, e]) => [n, e.key])).toEqual([["other", "k"], ["default", "p"]]);
        await shared.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("PersistentStorage change events", () => {
    let dir: string;
    let file: string;
    let storage: PersistentStorage;
    let events: StorageChange[];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-storage-"));
        file = path.join(dir, "s.jkv");
        storage = new PersistentStorage(file);
        events = [];
        storage.on("change", (e) => events.push(e));
    });

    afterEach(async () => {
        await storage.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("emits set with size, time, and user flag", () => {
        const before = Date.now();
        storage.setValue("@persistent-count", { a: 1 }, LATER);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "set", key: "@persistent-count", value: { a: 1 }, size: 7, internal: false });
        expect(events[0].at).toBeGreaterThanOrEqual(before);
    });

    it("flags internal keys but still emits them", () => {
        storage.setValue("_destroyers", [], LATER);
        expect(events.map(e => [e.key, e.internal])).toEqual([["_destroyers", true]]);
        expect(isInternalStorageKey("@persistent-x")).toBe(false);
    });

    it("owners declare further internal key prefixes", () => {
        expect(isInternalStorageKey("owned:abc")).toBe(false);
        registerInternalKeyPrefix("owned:");
        registerInternalKeyPrefix("owned:");
        expect(isInternalStorageKey("owned:abc")).toBe(true);
        storage.setValue("owned:abc", 1, LATER);
        expect(events[0]).toMatchObject({ key: "owned:abc", internal: true });
    });

    it("does not serialize values for size when nobody listens", () => {
        const toJSON = jest.fn(() => "x");
        storage.removeAllListeners("change");
        storage.setValue("k", { toJSON }, LATER);
        expect(toJSON).not.toHaveBeenCalled();
        expect(storage.keyInfo("k")).toEqual({ at: expect.any(Number), size: 3 }); // sized lazily, on demand
        expect(toJSON).toHaveBeenCalledTimes(1);
    });

    it("emits delete when setting null/undefined", () => {
        storage.setValue("k", 1, LATER);
        storage.setValue("k", undefined, LATER);
        expect(events[1]).toMatchObject({ type: "delete", key: "k", size: 0 });
    });

    it("emits set with updated value for objectSet and array ops", () => {
        storage.objectSet("o", "a", 1, LATER);
        storage.arrayPush("arr", 5, LATER);
        expect(events[0]).toMatchObject({ type: "set", key: "o", value: { a: 1 } });
        expect(events[1]).toMatchObject({ type: "set", key: "arr", value: [5] });
    });

    it("does not emit during load", async () => {
        storage.setValue("k", 1, OPTS);
        await storage.flushToDisk(true);
        const s2 = new PersistentStorage(file);
        const ev: StorageChange[] = [];
        s2.on("change", (e) => ev.push(e));
        await s2.load();
        expect(s2.getValue("k")).toBe(1);
        expect(ev).toEqual([]);
    });

    it("keyInfo reports size and last write", () => {
        storage.setValue("k", "abc", LATER);
        expect(storage.keyInfo("k")).toMatchObject({ size: 5 });
        expect(storage.keyInfo("k").at).toBe(events[0].at);
        expect(storage.keyInfo("missing")).toBeUndefined();
    });

    describe("deleteKey", () => {
        it("removes from store, journals DEL, emits delete", async () => {
            storage.setValue("k", 1, OPTS);
            await storage.flushToDisk(true);
            events.length = 0;

            await storage.deleteKey("k");
            expect(storage.hasKey("k")).toBe(false);
            expect(events).toEqual([expect.objectContaining({ type: "delete", key: "k" })]);

            const s2 = new PersistentStorage(file);
            await s2.load();
            expect(s2.hasKey("k")).toBe(false);
            await s2.dispose();
        });

        it("discards queued partial writes for the key", async () => {
            storage.objectSet("o", "a", 1, LATER);
            await storage.deleteKey("o");
            const s2 = new PersistentStorage(file);
            await s2.load();
            expect(s2.hasKey("o")).toBe(false);
            await s2.dispose();
        });

        it("is a no-op for missing keys", async () => {
            await storage.deleteKey("nope");
            expect(events).toEqual([]);
        });

        it("a later write by the app restores the key (in-memory value not touched)", async () => {
            const live = { n: 1 }; // app's in-memory value
            storage.setValue("k", live, OPTS);
            await storage.deleteKey("k");
            expect(live).toEqual({ n: 1 });
            storage.setValue("k", live, OPTS);
            expect(storage.getValue("k")).toBe(live);
        });
    });

    describe("keyBytes", () => {
        it("caches per key and recomputes only the changed key", () => {
            const s = storage;
            s.setValue("a", { x: "é" }, IMMEDIATE);
            s.setValue("b", [1, 2], IMMEDIATE);
            const spy = jest.spyOn(JSON, "stringify");
            try {
                expect(s.keyBytes("a")).toBe(Buffer.byteLength('{"x":"é"}'));
                expect(s.keyBytes("b")).toBe(5);
                expect(spy).toHaveBeenCalledTimes(2);
                s.keyBytes("a"); s.keyBytes("b");
                expect(spy).toHaveBeenCalledTimes(2); // no rescan

                s.arrayPush("b", 3, IMMEDIATE);
                expect(s.keyBytes("b")).toBe(7);
                s.objectSet("a", "y", 1, IMMEDIATE);
                expect(s.keyBytes("a")).toBe(Buffer.byteLength('{"x":"é","y":1}'));
            } finally {
                spy.mockRestore();
            }
        });

        it("is 0 after delete and fresh after load", async () => {
            const s = storage;
            s.setValue("a", "xx", IMMEDIATE);
            expect(s.keyBytes("a")).toBe(4);
            await s.deleteKey("a");
            expect(s.keyBytes("a")).toBe(0);
            s.setValue("a", "yyy", IMMEDIATE);
            await s.flushToDisk(true);
            const s2 = new PersistentStorage(file); await s2.load();
            expect(s2.keyBytes("a")).toBe(5);
            await s2.dispose();
        });
    });
});
