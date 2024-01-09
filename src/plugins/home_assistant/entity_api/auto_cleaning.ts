import { AbstractConstructor } from "type-fest";

import { TDEntity } from ".";
import { HomeAssistantPlugin } from "..";
import { DestroyerStore } from "../../../hypervisor/destroyer";
import { logMessage } from "../../../hypervisor/logging";
import { HyperWrapper } from "../../../hypervisor/managed_apps";
import { HomeAssistantApi, homeAssistantApi } from "../api";
import { EntityStore } from "./store";
import { get_plugin } from "../../base";

export interface AutoCleanEntry {
    uuid: string;
    name?: string;
    cleaner_opts: any;
    cleaner_key: string;
}

export const SymbolAutocleaner = Symbol("Autoclean Destructor");

export const autoCleanEntitiesKey = (plg: HomeAssistantPlugin) => {
    return `ha[${plg[HyperWrapper].id}].entities.auto_clean`;
}

function cleanerUUID(entity: TDEntity<any>) {
    return `${entity.uuid}-${(entity as any).domain}`;
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

    console.debug(`Adding '${entity.uuid}' to autocleans`);

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

export const autocleanEntities = async (store: EntityStore) => {
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
                console.debug(`Autocleaning '${ent.uuid}'`);
                const cleaner = getAutocleaner(ent.cleaner_key);
                // TODO Should this hold up the thread, or occur totally asynchronously?
                await cleaner.destroy_entity(ent.cleaner_opts, store);
            } catch (ex) {
                application.logMessage("warn", `Failed to autoclean entity '${ent.uuid}':`, ex)
            }
        }
    }
    application.persistedStorage.setValue(autocleanKey, keepEntriesByCUID, { min_time_to_disk: 0, max_time_to_disk: 10 });
}

export const HAEntititesDestroyer = DestroyerStore.defineDestroyerClass("HAEntities", async (app, { plugin_id }: { plugin_id: string }) => {
    logMessage("info", "Cleaning HA Entities");
    const pl = get_plugin<HomeAssistantPlugin>(plugin_id);
    const store = pl.api._getEntityStore();
    await autocleanEntities(store);
})
