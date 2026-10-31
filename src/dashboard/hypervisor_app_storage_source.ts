import * as fs from "fs";
import * as path from "path";
import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { isInternalStorageKey, PersistentStorage } from "../hypervisor/persistent_storage";
import { followAppEmitter } from "./follow_app";
import type { AppStorageSource } from "./app_storage_topic";
import type { AppStorageSnapshot, StorageRow } from "./protocol";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppStorageObserveHost = Pick<Hypervisor, 'getApplication' | 'on' | 'off'>;
export type AppStorageHost = AppStorageObserveHost & Pick<Hypervisor, 'listApplications' | 'working_directory' | 'defaultAppOperatingDirectory' | 'defaultAppPersistenceFile' | 'currentConfig' | 'withApplicationExclusive'>;

/** Objects/arrays serialized larger than this are sent as their shape only */
export const LAZY_BYTES = 32 * 1024;

const NO_STORE_STATES = ['stopping', 'stopped', 'dead'];

/** The app's store while its instance has it open (a stopped instance's store is closed; its file is the truth) */
function liveStore(app: Pick<ApplicationInstance, 'state' | 'persistedStorage'> | undefined): PersistentStorage | undefined {
    return app?.persistedStorage && !NO_STORE_STATES.includes(app.state) ? app.persistedStorage : undefined;
}

/** User key count for the tab badge; undefined while the app has no open store (reading the file just for a count is not worth it) */
export function appStorageCounts(app: Pick<ApplicationInstance, 'state' | 'persistedStorage'> | undefined) {
    const store = liveStore(app);
    return store ? { storage: store.keys.filter(k => !isInternalStorageKey(k)).length } : undefined;
}

/** Size and last write of the open store, for the overview card (undefined while there is none) */
export function appStorageSummary(app: Pick<ApplicationInstance, 'state' | 'persistedStorage'> | undefined) {
    const store = liveStore(app);
    if (!store) return undefined;
    let bytes = 0, internal = 0, lastWriteAt: number | undefined;
    for (const k of store.keys) {
        const value = store.getValue(k);
        if (value == null) continue;
        if (isInternalStorageKey(k)) { internal++; continue }
        bytes += store.keyBytes(k);
        const at = store.keyInfo(k)?.at;
        if (at !== undefined && (lastWriteAt === undefined || at > lastWriteAt)) lastWriteAt = at;
    }
    return { bytes, internal, ...(lastWriteAt !== undefined && { lastWriteAt }) };
}

function toRow(key: string, value: unknown, writtenAt: number): StorageRow {
    const json = JSON.stringify(value);
    const size = Buffer.byteLength(json);
    const row: StorageRow = { key, size, writtenAt, internal: isInternalStorageKey(key) };
    if (size > LAZY_BYTES && value !== null && typeof value === 'object') {
        row.lazy = Array.isArray(value)
            ? { kind: 'array', count: value.length, size }
            : { kind: 'object', count: Object.keys(value).length, size };
    } else {
        row.value = value;
    }
    return row;
}

const isOrphanDir = (host: Pick<AppStorageHost, 'defaultAppOperatingDirectory'>, id: string) => {
    try { return fs.lstatSync(host.defaultAppOperatingDirectory(id)).isDirectory() } catch { return false }
};

const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return Date.now() } };

/** Every key of `store` as a row; `file` (the store's file) dates keys not written during this run */
export function storageRows(store: PersistentStorage, file: string): StorageRow[] {
    const fallback = mtime(file);
    return store.keys
        .filter(k => store.getValue(k) != null)
        .map(k => toRow(k, store.getValue(k), store.keyInfo(k)?.at ?? fallback));
}

/** `cb` fires on every write/delete of the app's open store; follows restarts onto the new instance's store */
export function observeAppStorage(host: AppStorageObserveHost, appId: string, cb: () => void): () => void {
    return followAppEmitter(host, appId, cb, app => [liveStore(app)]);
}

export function hypervisorAppStorageSource(host: AppStorageHost): AppStorageSource & {
    value(appId: string, key: string): Promise<unknown>;
    remove(appId: string, key: string): Promise<void>;
} {
    const instance = (id: string) => host.getApplication(id);

    const fileOf = (id: string) => {
        const live = instance(id);
        // Neither configured nor running: an orphan, if its (default) operating dir is still there
        if (!live && !host.currentConfig.apps?.[id] && !isOrphanDir(host, id)) throw new Error(`Unknown app: ${id}`);
        return live ? live.persistence_file : host.defaultAppPersistenceFile(id);
    };

    /** Run `fn` on `live`'s open store, or on a temporary load of the app's file if it has none open */
    const useStore = async <T>(id: string, live: ApplicationInstance | undefined, fn: (s: PersistentStorage) => Promise<T> | T, mutates = false): Promise<T> => {
        const open = liveStore(live);
        if (open) return fn(open);
        const temp = new PersistentStorage(fileOf(id));
        await temp.load();
        try {
            return await fn(temp);
        } finally {
            if (mutates) await temp.dispose();
        }
    };

    /** Reads don't wait for exclusive access: a start can take long, and reading a file someone appends to is harmless */
    const read = <T>(id: string, fn: (s: PersistentStorage) => Promise<T> | T) => useStore(id, instance(id), fn);

    /** Changes the file only while no instance can start (else two writers would have it open), or through the live store */
    const mutate = async <T>(id: string, fn: (s: PersistentStorage) => Promise<T> | T) => {
        fileOf(id); // unknown app -> throws
        return host.withApplicationExclusive(id, live => useStore(id, live, fn, true));
    };

    return {
        async get(appId): Promise<AppStorageSnapshot | undefined> {
            let file: string;
            try { file = fileOf(appId) } catch { return undefined }
            return read(appId, store => ({ path: path.relative(host.working_directory, file), rows: storageRows(store, file) }));
        },

        onChange: (appId, cb) => observeAppStorage(host, appId, cb),

        value: (appId, key) => read(appId, store => {
            if (store.getValue(key) == null) throw new Error(`No key '${key}'`);
            return store.getValue(key);
        }),

        remove: (appId, key) => {
            if (isInternalStorageKey(key)) return Promise.reject(new Error(`Refusing to remove internal key '${key}'`));
            return mutate(appId, store => store.deleteKey(key));
        },
    };
}
