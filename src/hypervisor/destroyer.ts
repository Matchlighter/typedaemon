import * as objectHash from "object-hash";
import { ApplicationInstance } from "./application_instance";
import { logMessage } from "./logging";
import { PersistentStorage } from "./persistent_storage";

type DestroyerFunction<T> = (application: ApplicationInstance, configuration: T) => Promise<void>;

const DestroyerKeySymbol = Symbol("Destroyer Class Key");

export interface DestroyerEntry {
    uuid: string;
    type: string;
    options: any;
}

export class DestroyerStore {
    constructor(readonly application: ApplicationInstance) {
        // JKV is super overkill, but we've already got it, so...!
        // TODO Decide if we're going to use the primary persisted storage or a dedicated one
        // this.persist = new PersistentStorage(path.join(application.operating_directory, ".destroyers.jkv"));
    }

    private persist: PersistentStorage;
    declare ['constructor']: typeof DestroyerStore;

    static defineDestroyerClass<T>(key: string, destroy: DestroyerFunction<T>) {
        destroy[DestroyerKeySymbol] = key;
        this.destroyers[key] = destroy;
        return destroy;
    }

    private static destroyers: Record<string, DestroyerFunction<any>> = {};

    private static validateDestroyerFunction(destroy: DestroyerFunction<any>) {
        if (!destroy[DestroyerKeySymbol] || !this.destroyers[destroy[DestroyerKeySymbol]]) {
            throw new Error("Destroyer not registered!");
        }
    }

    requireDestroyer<T>(destroyer: DestroyerFunction<T>, options: T) {
        this.constructor.validateDestroyerFunction(destroyer);
        const uuid = this.destroyerUUID(destroyer, options);

        // Already registered, save a disk write
        if (this.getEntry(uuid)) return;

        this.setEntry(uuid, {
            uuid,
            type: destroyer[DestroyerKeySymbol],
            options,
        });
    }

    forgetDestroyer<T>(destroyer: DestroyerFunction<T>, options: T) {
        this.constructor.validateDestroyerFunction(destroyer);
        const uuid = this.destroyerUUID(destroyer, options)
        this.setEntry(uuid, undefined);
    }

    /** Pending destroyers, as registered */
    list(): DestroyerEntry[] {
        return Object.values(this.getEntries());
    }

    /**
     * Run every registered destroyer. A failing (or unknown) destroyer does not stop the others, but the failures are
     * reported together afterwards: whoever called this must not treat the app as cleaned up.
     */
    async destroyApplication() {
        const failures: string[] = [];
        for (let [uuid, info] of Object.entries(this.getEntries())) {
            const des = this.constructor.destroyers[info.type];
            if (!des) {
                logMessage("warn", `Unkown destroyer '${info.type}' with ${JSON.stringify(info.options)}`);
                failures.push(`Unknown destroyer '${info.type}'`);
                continue;
            }

            try {
                await des(this.application, info.options);
            } catch (ex) {
                logMessage("error", `Error in destroyer '${info.type}' with ${JSON.stringify(info.options)}:`, ex);
                failures.push(`Destroyer '${info.type}' failed: ${ex?.message ?? ex}`);
            }
        }
        if (failures.length) throw new Error(failures.join("; "));
    }

    async load() {
        await this.persist?.load();
    }

    async dispose() {
        await this.persist?.dispose();
    }

    protected getEntries(): Record<string, DestroyerEntry> {
        if (this.persist) {
            const obj = {};
            for (let k of this.persist.keys) {
                obj[k] = this.persist.getValue(k);
            }
            return obj;
        } else {
            return this.application.persistedStorage.getValue("_destroyers") || {};
        }
    }

    protected getEntry(uuid: string): DestroyerEntry {
        if (this.persist) {
            return this.persist.getValue(uuid);
        } else {
            return this.application.persistedStorage.getValue("_destroyers")?.[uuid];
        }
    }

    protected setEntry(uuid: string, entry: DestroyerEntry) {
        if (this.persist) {
            this.persist.setValue(uuid, entry, { min_time_to_disk: 0, max_time_to_disk: 10 });
        } else {
            this.application.persistedStorage.objectSet("_destroyers", uuid, entry, { min_time_to_disk: 0, max_time_to_disk: 10 });
        }
    }

    protected destroyerUUID<T>(destroyer: DestroyerFunction<T>, options: T) {
        return `${destroyer[DestroyerKeySymbol]}-${objectHash.sha1(options as any)}`;
    }
}
