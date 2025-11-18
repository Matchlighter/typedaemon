import * as path from "path";
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

interface SetAction {
    action: "SET";
    original_value: any;
}

type AnyAction = ObjectAction | SpliceAction | SetAction;

interface QueuedAction {
    action: AnyAction;
    not_before: number;
    not_after: number;
}

/**
 * This is a KV Store that Journals to disk. The Jorunaling reduces disk usage over writing the complete object to disk.
 * Upon shutdown, we try to clear the journal and store the minimal data set, but if something prevents that, the complete state should be recoverable from the journal
 * 
 * The Journal format is fairly simple - each line consists of a command, a space, and a JSON value. eg `MRG {"key":"value"}`
 */
export class PersistentStorage {
    constructor(readonly file_path: string) {

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
        // Short-circuit if the previous SET is being reverted
        const kactions = this.pending_actions[key];
        if (kactions && kactions.length == 1 && kactions[0].action?.action == "SET" && kactions[0].action.original_value === value) {
            delete this.pending_actions[key];
            this.kvstore[key] = value;
            return;
        }

        this.kvstore[key] = value;

        // Clear previous actions - we're overwriting them
        this.pending_actions[key] = [];

        this.pushAction(key, options, {
            action: "SET",
            original_value: this.kvstore[key],
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

        let last_error: Error;

        await read_lines(this.file_path, {}, (line) => {
            if (last_error) throw last_error;

            const [cmd, data] = split_once(line, " ");
            try {
                const pdata = JSON.parse(data);
                this.execCmd(cmd, pdata);
            } catch (ex) {
                // Ignore an error if it's the last line
                last_error = ex;
                // TODO Behavior?
                //   Throw and abort starting the application? (Safest data-wise)
                //   Log and ignore? (Resiliant, but possible data loss)
            }
        })
    }

    private execCmd(cmd: string, pdata: any) {
        if (cmd == "DEL") {
            for (let k of pdata) delete this.kvstore[k];
        } else if (cmd == "MRG") {
            Object.assign(this.kvstore, pdata);
        } else if (cmd == "SET") {
            this.kvstore = pdata;
        } else if (cmd == "ASPLC") {
            const arr: any[] = this.kvstore[pdata.key] ??= [];
            let idx = pdata.position ?? -1;
            if (idx < 0) idx = arr.length - idx + 1;
            arr.splice(idx, pdata.delete ?? 0, ...pdata.values);
        } else if (cmd == "OSET") {
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

                let changed = false;
                const delkeys = [];
                const changes = {};
                const remaining_actions: AnyAction[] = [];
                for (let [k, actions] of Object.entries(flush_actions)) {
                    for (let v of actions) {
                        const action = v.action;
                        if (action.action == "SET") {
                            const cv = this.kvstore[k];
                            if (cv == null) {
                                delkeys.push(k);
                            } else {
                                changed = true;
                                changes[k] = cv;
                            }
                        } else {
                            remaining_actions.push(action);
                        }
                    }
                }

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
            }, Date.now() - this.nextWriteTime)
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

export class SharedStorages {
    constructor(readonly root_directory: string) {

    }

    private _primary: PersistentStorage;
    get primary() { return this._primary }

    private loaded_storages: Record<string, PersistentStorage> = {};

    async initialize() {
        this._primary = await this.load("default");
    }

    async load(name: string) {
        let storage = this.loaded_storages[name];
        if (!storage) {
            storage = this.loaded_storages[name] = new PersistentStorage(path.resolve(this.root_directory, `${name}.jkv`));
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
