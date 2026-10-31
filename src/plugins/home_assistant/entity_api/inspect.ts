import type { AutoCleanEntry } from "./auto_cleaning";

/** What the HA plugin knows about one app entity, linked (registered by the running app) or not (only remembered by the autoclean registry) */
export interface AppEntityInfo {
    /** Stable across restarts: `<plugin id>:<autoclean registry key>` */
    key: string;
    plugin: string;
    domain: string;
    name?: string;
    /** HA's entity_id, once HA's entity registry knows the entity */
    entityId?: string;
    state?: string;
    linked: boolean;
    autoClean: boolean;
    persistState: boolean;
}

/** HA's live state object of an entity, minus its state string (that is `AppEntityInfo.state`) */
export interface EntityStateInfo {
    attributes: Record<string, unknown>;
    lastChanged?: string;
    lastUpdated?: string;
}

export interface EntityInspection {
    pluginId: string;
    tracked: Iterable<{ uuid: string; domain: string; entity_kind?: string; name?: string }>;
    /** The app's autoclean registry (`cuid` -> entry) */
    registry: Record<string, AutoCleanEntry>;
    /** HA entity registry, by entity_id */
    haEntities: Record<string, { entity_id: string; unique_id?: string }>;
    haStates: Record<string, { state: unknown }>;
    /** Uuids of entities registered with `persist_state` */
    persistedStateUuids: Set<string>;
}

/** Key of an entity in the autoclean registry. Keep in sync with `cleanerUUID` (auto_cleaning.ts) */
export const entityCuid = (e: { uuid: string; domain: string; entity_kind?: string }) => `${e.uuid}-${e.entity_kind ?? e.domain}`;

/** Merge tracked entities and the autoclean registry into rows: registry entries nobody tracks are the unlinked ones */
export function listEntityRows(i: EntityInspection): AppEntityInfo[] {
    const entityIdByUuid = new Map<string, string>();
    for (const e of Object.values(i.haEntities)) if (e.unique_id) entityIdByUuid.set(e.unique_id, e.entity_id);

    const build = (uuid: string, domain: string, name: string | undefined, cuid: string, linked: boolean): AppEntityInfo => {
        // Input helpers use their HA entity_id as uuid
        const entityId = entityIdByUuid.get(uuid) ?? (uuid.startsWith(`${domain}.`) ? uuid : undefined);
        const state = entityId !== undefined ? i.haStates[entityId]?.state : undefined;
        const row: AppEntityInfo = {
            key: `${i.pluginId}:${cuid}`, plugin: i.pluginId, domain,
            linked, autoClean: cuid in i.registry, persistState: i.persistedStateUuids.has(uuid),
        };
        if (name !== undefined) row.name = name;
        if (entityId !== undefined) row.entityId = entityId;
        if (state != null) row.state = String(state);
        return row;
    };

    const rows: AppEntityInfo[] = [];
    const trackedCuids = new Set<string>();
    for (const e of i.tracked) {
        const cuid = entityCuid(e);
        trackedCuids.add(cuid);
        rows.push(build(e.uuid, e.domain, e.name, cuid, true));
    }
    for (const [cuid, entry] of Object.entries(i.registry)) {
        if (trackedCuids.has(cuid)) continue;
        const domain = entry.cleaner_opts?.domain ?? cuid.slice(entry.uuid.length + 1);
        rows.push(build(entry.uuid, domain, entry.name, cuid, false));
    }
    return rows;
}
