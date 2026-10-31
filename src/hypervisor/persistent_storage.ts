import * as path from "path";
import { TypedEmitter } from "tiny-typed-emitter";
import { FileHandle, open, rename, writeFile } from "fs/promises";

import { AsyncLock } from "../common/async_lock";
import { fileExists, read_lines, split_once } from "../common/util";
import { logMessage } from "./logging";

export interface PersistentEntryOptions {
    // expiration?: string;
    // disposer?: {
    //     key: string;
    //     [k: string]: any;
    // }

    min_time_to_disk: number;
    max_time_to_disk: number;
}

interface SpliceAction {
    action: "ASPLC";
    key: string;
    values?: any[];
    position: number;
    delete?: number;
}

interface ObjectAction {
    action: "OSET";
    key: string;
    subkey: string;
    value: any;
}

/** Marks that the on-disk value of a key is not known (ie. there are unflushed non-SET actions) */
const UNKNOWN_DISK_VALUE = Symbol("unknown");

interface SetAction {
    action: "SET";
    /** The value on disk before this SET */
    original_value: any;
}

type AnyAction = ObjectAction | SpliceAction | SetAction;

interface QueuedAction {
    action: AnyAction;
    not_before: number;
    not_after: number;
}

/** A single key changed. `value` is the key's value after the change (undefined for deletes). */
export interface StorageChange {
    type: "set" | "delete";
    key: string;
    value?: any;
    /** Approximate serialized size (JSON length) of the value; 0 for deletes. Only computed when something listens. */
    size: number;
    /** ms epoch of the write */
    at: number;
    /** True for TypeDaemon-owned bookkeeping keys (vs. user `@persistent` data) */
    internal: boolean;
}

export interface StorageEvents {
    change: (change: StorageChange) => void;
}

const internal_key_prefixes = new Set<string>(["_"]);

/** Declare a key prefix as TypeDaemon-owned bookkeeping (hidden from user data, not deletable by users). Idempotent; prefixes live for the process. */
export function registerInternalKeyPrefix(prefix: string) {
    internal_key_prefixes.add(prefix);
}

/** Internal keys: `_`-prefixed (eg. destroyers registry) and any prefix declared via `registerInternalKeyPrefix` */
export function isInternalStorageKey(key: string) {
    for (const prefix of internal_key_prefixes) {
        if (key.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * This is a KV Store that Journals to disk. The Jorunaling reduces disk usage over writing the complete object to disk.
 * Upon shutdown, we try to clear the journal and store the minimal data set, but if something prevents that, the complete state should be recoverable from the journal
 * 
 * The Journal format is fairly simple - each line consists of a command, a space, and a JSON value. eg `MRG {"key":"value"}`
 */
export class PersistentStorage extends TypedEmitter<StorageEvents> {
    constructor(readonly file_path: string) {
        super();
    }

    private last_writes: Record<string, { at: number }> = {};

    private static sizeOf(value: any) {
        return JSON.stringify(value)?.length ?? 0;
    }

    /** UTF-8 bytes of each key's JSON, filled lazily by `keyBytes`; a key is dropped on every change to it */
    private bytes_cache = new Map<string, number>();

    /** Serialized (JSON, UTF-8) size of a key's value; cached until the key next changes, so repeat reads don't rescan the store */
    keyBytes(key: string): number {
        let n = this.bytes_cache.get(key);
        if (n === undefined) {
            n = Buffer.byteLength(JSON.stringify(this.kvstore[key]) ?? "");
            this.bytes_cache.set(key, n);
        }
        return n;
    }

    /** Size (computed on demand) and last-write time of a key, as of this process's lifetime (undefined if never written/deleted since load) */
    keyInfo(key: string) {
        const w = this.last_writes[key];
        if (!w) return undefined;
        return { at: w.at, size: PersistentStorage.sizeOf(this.kvstore[key]) };
    }

    private emitChange(key: string) {
        this.bytes_cache.delete(key);
        const exists = key in this.kvstore && this.kvstore[key] != null;
        const at = Date.now();
        if (exists) {
            this.last_writes[key] = { at };
        } else {
            delete this.last_writes[key];
        }
        // Serializing for size is O(value) - skip it when nobody is watching
        if (!this.listenerCount("change")) return;
        const value = exists ? this.kvstore[key] : undefined;
        const size = exists ? PersistentStorage.sizeOf(value) : 0;
        this.emit("change", { type: exists ? "set" : "delete", key, value, size, at, internal: isInternalStorageKey(key) });
    }

    /**
     * Removes a key from the store/journal ONLY. Whoever owns the in-memory value (eg an app's `@persistent` property)
     * keeps it until its next write (which re-creates the key) or restart (where it's lost).
     */
    async deleteKey(key: string) {
        if (!this.hasKey(key)) return;
        this.setValue(key, undefined, { min_time_to_disk: 0, max_time_to_disk: 0 });
        await this.flushToDisk(true);
    }

    protected hasBeenModified = false;

    private file_lock = new AsyncLock({})

    private kvstore: Record<string, any> = {};
    private pending_actions: Record<string, QueuedAction[]> = {}

    get keys() { return Object.keys(this.kvstore) }

    getValue<T>(key: string): T {
        return this.kvstore[key];
    }

    hasKey(key: string) {
        return key in this.kvstore;
    }

    setValue<T>(key: string, value: T, options: PersistentEntryOptions) {
        const kactions = this.pending_actions[key];

        let disk_value: any = UNKNOWN_DISK_VALUE;
        if (!kactions?.length) {
            disk_value = this.kvstore[key];
        } else if (kactions.length == 1 && kactions[0].action.action == "SET") {
            disk_value = kactions[0].action.original_value;
        }

        if (value === undefined) {
            delete this.kvstore[key];
        } else {
            this.kvstore[key] = value;
        }
        this.emitChange(key);

        // Short-circuit if the pending SET is being reverted
        if (kactions?.length && disk_value === value) {
            delete this.pending_actions[key];
            return;
        }

        // Clear previous actions - we're overwriting them
        this.pending_actions[key] = [];

        this.pushAction(key, options, {
            action: "SET",
            original_value: disk_value,
        })
    }

    objectSet(key: string, subkey: string, value: any, options: PersistentEntryOptions) {
        this.pushAndExecAction(key, options, {
            action: "OSET",
            key,
            subkey,
            value,
        });
    }

    arrayPush(key: string, value: any, options: PersistentEntryOptions, position?) {
        this.pushAndExecAction(key, options, {
            action: "ASPLC",
            key,
            position,
            values: [value],
        });
    }

    arrayPop(key: string, options: PersistentEntryOptions, position?) {
        this.pushAndExecAction(key, options, {
            action: "ASPLC",
            key,
            position,
            delete: 1,
        });
    }

    async load() {
        if (!await fileExists(this.file_path)) return;

        let corruption: Error;

        await read_lines(this.file_path, {}, (line, last) => {
            const [cmd, data] = split_once(line, " ");
            try {
                const pdata = JSON.parse(data);
                this.execCmd(cmd, pdata);
            } catch (ex) {
                // Ignore an error if it's the last line - it was likely only partially written
                if (last) return;

                // TODO Behavior?
                //   Throw and abort starting the application? (Safest data-wise)
                //   Log and ignore? (Resiliant, but possible data loss)
                corruption = ex;
                // NB: Throwing from here would escape line-reader and leave this Promise pending forever
                return false;
            }
        })

        if (corruption) throw corruption;
    }

    private execCmd(cmd: string, pdata: any) {
        if (cmd == "DEL") {
            for (let k of pdata) { delete this.kvstore[k]; this.bytes_cache.delete(k) }
        } else if (cmd == "MRG") {
            Object.assign(this.kvstore, pdata);
            for (let k of Object.keys(pdata)) this.bytes_cache.delete(k);
        } else if (cmd == "SET") {
            this.kvstore = pdata;
            this.bytes_cache.clear();
        } else if (cmd == "ASPLC") {
            this.bytes_cache.delete(pdata.key);
            const arr: any[] = this.kvstore[pdata.key] ??= [];
            // Same semantics as Array.prototype.splice(). Defaults to the end of the array (ie. push/pop)
            const idx = pdata.position ?? (pdata.delete ? -pdata.delete : arr.length);
            arr.splice(idx, pdata.delete ?? 0, ...(pdata.values ?? []));
        } else if (cmd == "OSET") {
            this.bytes_cache.delete(pdata.key);
            const obj: any = this.kvstore[pdata.key] ??= {};
            if (pdata.value === undefined) {
                delete obj[pdata.subkey];
            } else {
                obj[pdata.subkey] = pdata.value;
            }
        }
    }

    private filehandle: FileHandle;
    async flushToDisk(force = false) {
        await this.file_lock.acquire("write", async () => {
            try {
                this.cancelWriteTimer();

                const dtn = Date.now();

                const future_actions: Record<string, QueuedAction[]> = {};
                let flush_actions: Record<string, QueuedAction[]> = {};

                if (force) {
                    flush_actions = this.pending_actions;
                } else {
                    // Iterate pending actions. Move any w/ past not_before to a new set
                    for (let [k, actions] of Object.entries(this.pending_actions)) {
                        let group_futures: QueuedAction[] = [];
                        for (let v of actions) {
                            if (v.not_before < dtn && group_futures.length == 0) {
                                (flush_actions[k] ||= []).push(v);
                            } else if (v.not_after <= dtn) {
                                // If a newer action _needs_ to be written, ignore any previous not_before values and write
                                (flush_actions[k] ||= []).push(...group_futures, v);
                                group_futures = [];
                            } else {
                                group_futures.push(v);
                            }
                        }
                        future_actions[k] = group_futures;
                    }
                }
                this.pending_actions = future_actions;

                // Write items
                if (!this.filehandle) {
                    this.filehandle = await open(this.file_path, "a");
                }

                const delkeys = [];
                const changes = {};
                const remaining_actions: AnyAction[] = [];
                for (let [k, actions] of Object.entries(flush_actions)) {
                    // A SET is always first (it clears prior actions). It writes the current value, which already
                    //   includes the effects of any later actions on the key - flushed now or still pending.
                    if (actions[0]?.action.action == "SET") {
                        if (k in this.kvstore) {
                            changes[k] = this.kvstore[k];
                        } else {
                            delkeys.push(k);
                        }
                        delete this.pending_actions[k];
                    } else {
                        remaining_actions.push(...actions.map(v => v.action));
                    }
                }

                const changed = Object.keys(changes).length > 0;
                if (delkeys.length) await this.filehandle.write(`DEL ${JSON.stringify(delkeys)}\n`);
                if (changed) await this.filehandle.write(`MRG ${JSON.stringify(changes)}\n`);

                for (let action of remaining_actions) {
                    await this.filehandle.write(`${action.action} ${JSON.stringify(action)}\n`);
                }

                if (delkeys.length || changed || remaining_actions.length) {
                    await this.filehandle.sync();
                }
            } finally {
                this.scheduleWriteTask();
            }
        })
    }

    // TODO Schedule an occasional fullWriteToDisk?

    async fullWriteToDisk() {
        await this.file_lock.acquire("write", async () => {
            this.cancelWriteTimer();

            const tmp_file = this.file_path + ".tmp";
            await writeFile(tmp_file, `SET ${JSON.stringify(this.kvstore)}\n`);
            await this.filehandle?.close();
            this.filehandle = null;
            await rename(tmp_file, this.file_path);

            // Everything pending is captured by the full write
            this.pending_actions = {};
            this.hasBeenModified = false;
        });
    }

    private nextWriteTime: number;
    private nextWriteTimer
    protected scheduleWriteTask(subset?: QueuedAction[]) {
        subset ||= this.allPendingActions();

        let nt = Math.min(...subset.map(pw => pw.not_after));
        nt = Math.max(nt, Date.now() + 10);

        if (subset.length && nt && (!this.nextWriteTimer || nt < this.nextWriteTime)) {
            if (this.nextWriteTimer) clearTimeout(this.nextWriteTimer);
            this.nextWriteTime = nt;
            this.nextWriteTimer = setTimeout(() => {
                if (this._disposed) {
                    logMessage("error", "PersistentStorage timer ticked after disposal");
                    return;
                }
                this.flushToDisk(false);
            }, this.nextWriteTime - Date.now())
        }
    }

    private allPendingActions() {
        const allactions = [];
        for (let [k, actions] of Object.entries(this.pending_actions)) {
            for (let v of actions) {
                allactions.push(v);
            }
        }
        return allactions;
    }

    private pushAction(key: string, options: PersistentEntryOptions, action: AnyAction) {
        if (this._disposed) throw new Error("Attempt to modify PersistentStorage after disposal!");
        this.hasBeenModified = true;

        const dtn = Date.now();
        const qaction: QueuedAction = {
            action,
            not_before: dtn + options.min_time_to_disk * 1000,
            not_after: dtn + options.max_time_to_disk * 1000,
        }
        const actions = this.pending_actions[key] ||= [];
        actions.push(qaction);
        this.scheduleWriteTask([qaction]);
    }

    private pushAndExecAction(key: string, options: PersistentEntryOptions, action: AnyAction) {
        this.execCmd(action.action, action);
        this.pushAction(key, options, action);
        this.emitChange(key);
    }

    private cancelWriteTimer() {
        if (this.nextWriteTimer) clearTimeout(this.nextWriteTimer);
        this.nextWriteTime = null;
        this.nextWriteTimer = null;
    }

    private _disposed = false;
    async dispose() {
        this._disposed = true;

        // No need to write if absolutely no changes have occurred
        if (this.hasBeenModified) {
            try {
                await this.fullWriteToDisk();
            } catch (ex) {
                await this.flushToDisk(true);
                throw ex;
            }
        }
        this.cancelWriteTimer();
        await this.filehandle?.close();
    }
}

export class SharedStorages extends TypedEmitter<{ change: (storage_name: string, change: StorageChange) => void }> {
    constructor(readonly root_directory: string) {
        super();
    }

    /** Names of loaded stores */
    list() { return Object.keys(this.loaded_storages) }

    /** A loaded store, or undefined */
    get(name: string): PersistentStorage | undefined { return this.loaded_storages[name] }

    /** Absolute file of a store (loaded or not) */
    fileOf(name: string) { return path.resolve(this.root_directory, `${name}.jkv`) }

    private _primary: PersistentStorage;
    get primary() { return this._primary }

    private users: Record<string, Set<string>> = {};

    /** Record that an app accessed a store (this run only; not persisted) */
    noteUse(name: string, appId: string | undefined) {
        if (appId) (this.users[name] ??= new Set()).add(appId);
    }

    /** Ids of apps that accessed a store since start, sorted */
    usedBy(name: string): string[] { return [...(this.users[name] ?? [])].sort() }

    private loaded_storages: Record<string, PersistentStorage> = {};

    async initialize() {
        this._primary = await this.load("default");
    }

    async load(name: string) {
        let storage = this.loaded_storages[name];
        if (!storage) {
            storage = this.loaded_storages[name] = new PersistentStorage(this.fileOf(name));
            storage.on("change", (change) => this.emit("change", name, change));
            await storage.load();
        }
        return storage;
    }

    async dispose() {
        for (let [k, storage] of Object.entries(this.loaded_storages)) {
            try {
                await storage.dispose();
            } catch (ex) {
                console.error(`Failed to save storage "${k}": `, ex);
            }
        }
    }
}
