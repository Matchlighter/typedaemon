import { HA_PLUGIN_KEY_PREFIX } from "../storage_keys";
import { AbstractConstructor } from "type-fest";

import { TDEntity } from ".";
import { HomeAssistantPlugin } from "../plugin";
import { DestroyerStore } from "../../../hypervisor/destroyer";
import { logMessage, logPluginClientMessage } from "../../../hypervisor/logging";
import { HyperWrapper } from "../../../hypervisor/managed_apps";
import { get_plugin } from "../../base";
import { entityCuid } from "./inspect";
import { EntityStore } from "./store";

export interface AutoCleanEntry {
    uuid: string;
    name?: string;
    cleaner_opts: any;
    cleaner_key: string;
}

export const SymbolAutocleaner = Symbol("Autoclean Destructor");

export const autoCleanEntitiesKey = (plg: HomeAssistantPlugin) => {
    return `${HA_PLUGIN_KEY_PREFIX}${plg[HyperWrapper].id}].entities.auto_clean`;
}

function cleanerUUID(entity: TDEntity<any>) {
    return entityCuid(entity as any);
}

export interface Autocleaner<T extends TDEntity<any> = TDEntity<any>, P = any> {
    key: string;
    make_entry: (entity: T) => P;
    destroy_entity: (data: P, store: EntityStore) => Promise<void>;
}

export const setAutocleaner = <T extends TDEntity<any>>(cls: AbstractConstructor<T>, cleaner: Autocleaner<T>) => {
    cls[SymbolAutocleaner] = cleaner;
    registerAutocleaner(cleaner);
}

const autocleaners: Record<string, Autocleaner> = {};

export const getAutocleaner = (key: string) => {
    return autocleaners[key];
}

export const registerAutocleaner = (cleaner: Autocleaner | { [SymbolAutocleaner]: Autocleaner }) => {
    if (cleaner[SymbolAutocleaner]) cleaner = cleaner[SymbolAutocleaner];
    // @ts-ignore
    autocleaners[cleaner.key] = cleaner;
}

export const trackAutocleanEntity = (store: EntityStore, entity: TDEntity<any>) => {
    const cleaner: Autocleaner = entity.constructor[SymbolAutocleaner];
    if (!cleaner) return;

    logPluginClientMessage(store.plugin, "debug", `Adding '${entity.uuid}' to autocleans`);

    const { application, plugin } = store;

    const autocleanKey = autoCleanEntitiesKey(plugin);
    const entry: AutoCleanEntry = {
        uuid: entity.uuid,
        name: (entity as any).name,
        cleaner_opts: cleaner.make_entry(entity),
        cleaner_key: cleaner.key,
    }
    application.persistedStorage.objectSet(autocleanKey, cleanerUUID(entity), entry, { min_time_to_disk: 5, max_time_to_disk: 15 });
}

/**
 * Remove from HA every autoclean entry the app does not track. An entry whose removal fails stays in the registry (retried
 * next time) and is returned; callers that must not proceed past a failure (orphan cleanup) check the result.
 */
export const autocleanEntities = async (store: EntityStore) => {
    const failures: { uuid: string; error: Error }[] = [];
    const { application, plugin } = store;
    const currentEnityIds = new Set<string>();
    for (let ent of store.tracked_entities) {
        currentEnityIds.add(ent.uuid);
    }

    const autocleanKey = autoCleanEntitiesKey(plugin);
    const entries: Record<string, AutoCleanEntry> = application.persistedStorage.getValue(autocleanKey) ?? {};

    // Only allow each UUID (but not CUID) once. This allows this logic to work when a UUID is re-used/transmuted to a different domain
    const encounteredUUIDs = new Set<string>();
    const keepEntriesByCUID = {};

    for (let [cuid, ent] of Object.entries(entries).reverse()) {
        if (currentEnityIds.has(ent.uuid) && !encounteredUUIDs.has(ent.uuid)) {
            encounteredUUIDs.add(ent.uuid)
            keepEntriesByCUID[cuid] = ent;
        } else {
            try {
                logPluginClientMessage(plugin, "debug", `Autocleaning '${ent.uuid}'`);
                const cleaner = getAutocleaner(ent.cleaner_key);
                // TODO Should this hold up the thread, or occur totally asynchronously?
                await cleaner.destroy_entity(ent.cleaner_opts, store);
            } catch (ex) {
                logPluginClientMessage(plugin, "warn", `Failed to autoclean entity '${ent.uuid}':`, ex)
                // Forgetting it would leave the entity in HA for good
                keepEntriesByCUID[cuid] = ent;
                failures.push({ uuid: ent.uuid, error: ex });
            }
        }
    }
    application.persistedStorage.setValue(autocleanKey, keepEntriesByCUID, { min_time_to_disk: 0, max_time_to_disk: 10 });
    return failures;
}

/**
 * Remove one unlinked entity (an autoclean registry entry the app no longer tracks) from HA and the registry.
 * The registry entry stays if HA removal fails, so it can be retried.
 */
export const destroyUnlinkedEntity = async (store: EntityStore, cuid: string) => {
    const { application, plugin } = store;
    const autocleanKey = autoCleanEntitiesKey(plugin);
    const entry: AutoCleanEntry | undefined = application.persistedStorage.getValue(autocleanKey)?.[cuid];
    if (!entry) throw new Error(`No unlinked entity '${cuid}'`);
    if ([...store.tracked_entities].some(e => cleanerUUID(e) === cuid)) throw new Error(`Entity '${cuid}' is still linked`);

    logPluginClientMessage(plugin, "debug", `Deleting unlinked entity '${entry.uuid}'`);
    await getAutocleaner(entry.cleaner_key).destroy_entity(entry.cleaner_opts, store);
    application.persistedStorage.objectSet(autocleanKey, cuid, undefined, { min_time_to_disk: 0, max_time_to_disk: 10 });
    plugin.entityEvents.emit('change', application);
}

export const HAEntititesDestroyer = DestroyerStore.defineDestroyerClass("HAEntities", async (app, { plugin_id }: { plugin_id: string }) => {
    logMessage("info", "Cleaning HA Entities");
    const pl = get_plugin<HomeAssistantPlugin>(plugin_id);
    const store = pl.api._getEntityStore();
    const failures = await autocleanEntities(store);
    if (failures.length) {
        throw new Error(`Couldn't remove ${failures.length} entities from Home Assistant: ${failures.map(f => `${f.uuid} (${f.error?.message ?? f.error})`).join(", ")}`);
    }
})
