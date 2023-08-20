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

interface PendingWrite {
    original_value: any;
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

    private file_lock = new AsyncLock({})

    private kvstore: Record<string, any> = {};
    private pending_writes: Record<string, PendingWrite> = {};

    get keys() { return Object.keys(this.kvstore) }

    getValue<T>(key: string): T {
        return this.kvstore[key];
    }

    hasKey(key: string) {
        return key in this.kvstore;
    }

    setValue<T>(key: string, value: T, options: PersistentEntryOptions) {
        if (this._disposed) throw new Error("Attempt to set a PersistentStorage key after disposal!");

        const pw: PendingWrite = this.pending_writes[key] || {
            original_value: this.kvstore[key],
            not_after: null,
            not_before: null,
        }
        const dtn = Date.now();
        pw.not_before = dtn + options.min_time_to_disk * 1000;
        pw.not_after = dtn + options.max_time_to_disk * 1000;

        this.pending_writes[key] = pw;
        this.kvstore[key] = value;
        this.scheduleWriteTask([pw]);
    }

    async load() {
        if (!await fileExists(this.file_path)) return;

        await read_lines(this.file_path, {}, (line) => {
            const [cmd, data] = split_once(line, " ");
            const pdata = JSON.parse(data);
            if (cmd == "DEL") {
                for (let k of pdata) delete this.kvstore[k];
            } else if (cmd == "MRG") {
                Object.assign(this.kvstore, pdata);
            } else if (cmd == "SET") {
                this.kvstore = pdata;
            }
        })
    }

    private filehandle: FileHandle;
    async flushToDisk(force = false) {
        await this.file_lock.acquire("write", async () => {
            try {
                this.cancelWriteTimer();

                const dtn = Date.now();
                const future_writes: Record<string, PendingWrite> = {};
                let flush_writes: Record<string, PendingWrite> = {};

                if (force) {
                    flush_writes = this.pending_writes;
                } else {
                    // Iterate pending writes. Move any w/ past not_before to a new set
                    for (let [k, v] of Object.entries(this.pending_writes)) {
                        if (v.not_before < dtn) {
                            flush_writes[k] = v;
                        } else {
                            future_writes[k] = v;
                        }
                    }
                }
                this.pending_writes = future_writes;

                // Write items
                if (!this.filehandle) {
                    this.filehandle = await open(this.file_path, "a");
                }

                let changed = false;
                const delkeys = [];
                const changes = {};
                for (let [k, v] of Object.entries(flush_writes)) {
                    const cv = this.kvstore[k];
                    if (v.original_value === cv) continue;
                    if (cv == null) {
                        delkeys.push(k);
                    } else {
                        changed = true;
                        changes[k] = cv;
                    }
                }

                if (delkeys.length) await this.filehandle.write(`DEL ${JSON.stringify(delkeys)}\n`);
                if (changed) await this.filehandle.write(`MRG ${JSON.stringify(changes)}\n`);
                if (delkeys.length || changed) {
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
        });
    }

    private nextWriteTime: number;
    private nextWriteTimer
    protected scheduleWriteTask(subset?: PendingWrite[]) {
        subset ||= Object.values(this.pending_writes);

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

    private cancelWriteTimer() {
        if (this.nextWriteTimer) clearTimeout(this.nextWriteTimer);
        this.nextWriteTime = null;
        this.nextWriteTimer = null;
    }

    private _disposed = false;
    async dispose() {
        this._disposed = true;
        try {
            await this.fullWriteToDisk();
        } catch (ex) {
            await this.flushToDisk(true);
            throw ex;
        }
        this.cancelWriteTimer();
        await this.filehandle?.close();
    }
}
