import { comparer, reaction } from "mobx";

import { saveGeneratedTypes } from "../../common/generate_tsconfig";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import type { HomeAssistantPlugin } from "./plugin";

/**
 * Entity IDs of the user's Home Assistant, keyed by entity ID.
 *
 * Empty here; augmented by the `.d.ts` that the HA plugin generates from the live entity list.
 */
export interface HassEntityIdRegistry { }

type KnownHassEntityIds = keyof HassEntityIdRegistry & string;

/** All known entity IDs (any `string` until entity types have been generated) */
export type HassEntityIds = [KnownHassEntityIds] extends [never] ? string : KnownHassEntityIds;

/** Known entity IDs of domain `D` (any `D.*` until entity types have been generated) */
export type HassEntityIdsOf<D extends string> = [KnownHassEntityIds] extends [never] ? `${D}.${string}` : Extract<KnownHassEntityIds, `${D}.${string}`>;

export type HassAlarmControlPanelIds = HassEntityIdsOf<"alarm_control_panel">;
export type HassAutomationIds = HassEntityIdsOf<"automation">;
export type HassBinarySensorIds = HassEntityIdsOf<"binary_sensor">;
export type HassButtonIds = HassEntityIdsOf<"button">;
export type HassCalendarIds = HassEntityIdsOf<"calendar">;
export type HassCameraIds = HassEntityIdsOf<"camera">;
export type HassClimateIds = HassEntityIdsOf<"climate">;
export type HassCounterIds = HassEntityIdsOf<"counter">;
export type HassCoverIds = HassEntityIdsOf<"cover">;
export type HassDateIds = HassEntityIdsOf<"date">;
export type HassDateTimeIds = HassEntityIdsOf<"datetime">;
export type HassDeviceTrackerIds = HassEntityIdsOf<"device_tracker">;
export type HassEventIds = HassEntityIdsOf<"event">;
export type HassFanIds = HassEntityIdsOf<"fan">;
export type HassGroupIds = HassEntityIdsOf<"group">;
export type HassHumidifierIds = HassEntityIdsOf<"humidifier">;
export type HassImageIds = HassEntityIdsOf<"image">;
export type HassInputBooleanIds = HassEntityIdsOf<"input_boolean">;
export type HassInputButtonIds = HassEntityIdsOf<"input_button">;
export type HassInputDateTimeIds = HassEntityIdsOf<"input_datetime">;
export type HassInputNumberIds = HassEntityIdsOf<"input_number">;
export type HassInputSelectIds = HassEntityIdsOf<"input_select">;
export type HassInputTextIds = HassEntityIdsOf<"input_text">;
export type HassLawnMowerIds = HassEntityIdsOf<"lawn_mower">;
export type HassLightIds = HassEntityIdsOf<"light">;
export type HassLockIds = HassEntityIdsOf<"lock">;
export type HassMediaPlayerIds = HassEntityIdsOf<"media_player">;
export type HassNotifyIds = HassEntityIdsOf<"notify">;
export type HassNumberIds = HassEntityIdsOf<"number">;
export type HassPersonIds = HassEntityIdsOf<"person">;
export type HassRemoteIds = HassEntityIdsOf<"remote">;
export type HassSceneIds = HassEntityIdsOf<"scene">;
export type HassScheduleIds = HassEntityIdsOf<"schedule">;
export type HassScriptIds = HassEntityIdsOf<"script">;
export type HassSelectIds = HassEntityIdsOf<"select">;
export type HassSensorIds = HassEntityIdsOf<"sensor">;
export type HassSirenIds = HassEntityIdsOf<"siren">;
export type HassSunIds = HassEntityIdsOf<"sun">;
export type HassSwitchIds = HassEntityIdsOf<"switch">;
export type HassTextIds = HassEntityIdsOf<"text">;
export type HassTimeIds = HassEntityIdsOf<"time">;
export type HassTimerIds = HassEntityIdsOf<"timer">;
export type HassTodoIds = HassEntityIdsOf<"todo">;
export type HassUpdateIds = HassEntityIdsOf<"update">;
export type HassVacuumIds = HassEntityIdsOf<"vacuum">;
export type HassValveIds = HassEntityIdsOf<"valve">;
export type HassWaterHeaterIds = HassEntityIdsOf<"water_heater">;
export type HassWeatherIds = HassEntityIdsOf<"weather">;
export type HassZoneIds = HassEntityIdsOf<"zone">;

export interface EntityTypesConfig {
    /** Only include entities with at least one of these labels (by label ID or name) */
    labels?: string[];
}

interface EntityIdEntry {
    entity_id: string;
    name?: string;
}

/** List the entities to include in the generated types, sorted by entity ID */
export function collectEntities(plugin: HomeAssistantPlugin, config: EntityTypesConfig): EntityIdEntry[] {
    let entity_ids = Object.values(plugin.state).map(s => s.entity_id);

    if (config.labels?.length) {
        const wanted = new Set(config.labels);
        const label_ids = new Set(Object.values(plugin.labels).filter(l => wanted.has(l.label_id) || wanted.has(l.name)).map(l => l.label_id));
        const labelled = new Set(Object.values(plugin.entities).filter(e => e.label_ids?.some(l => label_ids.has(l))).map(e => e.entity_id));
        entity_ids = entity_ids.filter(id => labelled.has(id));
    }

    // Names come from the entity registry (rather than state attributes) so that state changes don't trigger a recompute
    const registry = new Map(Object.values(plugin.entities).map(e => [e.entity_id, e]));
    return entity_ids.sort().map(entity_id => {
        const reg = registry.get(entity_id);
        return { entity_id, name: reg?.name || reg?.original_name };
    });
}

export function generateEntityTypes(entities: EntityIdEntry[]) {
    const lines: string[] = [];
    for (const { entity_id, name } of entities) {
        if (name) lines.push(`        /** ${String(name).replaceAll("*/", "*\\/")} */`);
        lines.push(`        ${JSON.stringify(entity_id)}: true;`);
    }
    return [
        "// Generated by TypeDaemon. Do not edit.",
        // Makes this file a module, so the `declare module` below augments rather than declares
        `export {};`,
        `declare module "@td" {`,
        `    interface HassEntityIdRegistry {`,
        ...lines,
        `    }`,
        `}`,
        "",
    ].join("\n");
}

/**
 * Keep the generated entity types in sync with Home Assistant's entities.
 *
 * Returns a disposer.
 */
export function syncEntityTypes(plugin: HomeAssistantPlugin, config: EntityTypesConfig) {
    const instance = plugin[HyperWrapper];
    return reaction(
        () => plugin._synced_store.isInitialized ? collectEntities(plugin, config) : null,
        async (entities) => {
            if (!entities) return;
            try {
                await saveGeneratedTypes(instance.hypervisor, `ha_entities.${instance.id}`, generateEntityTypes(entities));
            } catch (ex) {
                instance.logMessage("warn", `Failed to write entity types:`, ex);
            }
        },
        { fireImmediately: true, delay: 5_000, equals: comparer.structural },
    );
}
