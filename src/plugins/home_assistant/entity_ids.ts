import { comparer, reaction, untracked } from "mobx";
import parse_duration from "parse-duration";

import { saveGeneratedTypes } from "../../common/generate_tsconfig";
import { SlidingWindowCounter } from "../../common/rate_window";
import { HyperWrapper } from "../../hypervisor/managed_apps";
import type { HassServiceTarget } from "home-assistant-js-websocket";

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

/** An entity ID; known IDs are suggested, but any string is accepted (eg for entities excluded from generation) */
export type HassEntityIdLike = HassEntityIds | (string & {});

/** A record keyed by entity ID. Known IDs are suggested (with their generated docs), but any string may be used */
/** `HassServiceTarget`, with entity IDs suggested */
export type HassEntityServiceTarget = Omit<HassServiceTarget, "entity_id"> & { entity_id?: HassEntityIdLike | HassEntityIdLike[] };

export type HassEntityRecord<V> = { readonly [K in keyof HassEntityIdRegistry]: V } & { readonly [entity_id: string]: V };

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

    /** Minimum time between regenerations. Duration string (eg `"30s"`) or milliseconds. Default `"30s"` */
    min_interval?: string | number;

    /**
     * Guard against entity churn: if more than `count` regenerations occur within `window`, a warning is raised and
     * generation is paused until the rate drops. Defaults to 10 per `"15m"`.
     */
    rate_limit?: {
        count?: number;
        /** Duration string (eg `"15m"`) or milliseconds */
        window?: string | number;
    };

    /** Create a Home Assistant persistent notification while generation is paused. Default `true` */
    notify?: boolean;
}

interface EntityIdEntry {
    entity_id: string;
    /** JSDoc lines */
    docs: string[];
}

function describeEntity(plugin: HomeAssistantPlugin, entity_id: string, reg?: HomeAssistantPlugin["entities"][string]) {
    // Attributes are read untracked, so that state changes don't trigger a recompute (they're picked up on the next one)
    const attrs = untracked(() => plugin.state[entity_id]?.attributes) || {};
    const name = attrs.friendly_name || reg?.name || reg?.original_name;

    const docs: string[] = [];
    if (name) docs.push(`**${name}**`, "");
    const details: [string, any][] = [
        ["Area", reg?.area?.name],
        ["Device", reg?.device && (reg.device.name_by_user || reg.device.name)],
        ["Integration", reg?.platform],
        ["Labels", reg?.labels?.map(l => l.name).join(", ")],
        ["Device class", attrs.device_class],
        ["Unit", attrs.unit_of_measurement],
    ];
    for (const [k, v] of details) {
        if (v) docs.push(`- ${k}: ${v}`);
    }
    return docs;
}

/** List the entities to include in the generated types, sorted by entity ID */
export function collectEntities(plugin: HomeAssistantPlugin, config: EntityTypesConfig): EntityIdEntry[] {
    let entity_ids = Object.values(plugin.state).map(s => s.entity_id);
    const registry = new Map(Object.values(plugin.entities).map(e => [e.entity_id, e]));

    if (config.labels?.length) {
        const wanted = new Set(config.labels);
        const label_ids = new Set(Object.values(plugin.labels).filter(l => wanted.has(l.label_id) || wanted.has(l.name)).map(l => l.label_id));
        entity_ids = entity_ids.filter(id => registry.get(id)?.label_ids?.some(l => label_ids.has(l)));
    }

    return entity_ids.sort().map(entity_id => ({
        entity_id,
        docs: describeEntity(plugin, entity_id, registry.get(entity_id)),
    }));
}

export function generateEntityTypes(entities: EntityIdEntry[]) {
    const lines: string[] = [];
    for (const { entity_id, docs } of entities) {
        if (docs.length) {
            lines.push(`        /**`);
            for (const d of docs) lines.push(`         * ${String(d).replaceAll("*/", "*\\/")}`.trimEnd());
            lines.push(`         */`);
        }
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

const ISSUE_KEY = "entity_types";

const toMs = (d: string | number) => typeof d == "number" ? d : parse_duration(d);

/**
 * Keep the generated entity types in sync with Home Assistant's entities.
 *
 * Returns a disposer.
 */
export function syncEntityTypes(plugin: HomeAssistantPlugin, config: EntityTypesConfig) {
    const instance = plugin[HyperWrapper];
    const notification_id = `typedaemon_entity_types_${instance.id}`;
    const notify = config.notify ?? true;

    const max_count = config.rate_limit?.count ?? 10;
    const window = config.rate_limit?.window ?? "15m";
    const counter = new SlidingWindowCounter(toMs(window));

    let pending: EntityIdEntry[] = null;
    let paused = false;
    let resume_timer: ReturnType<typeof setTimeout>;

    const callService = (service: string, data: any) => plugin.callService(service, data).catch((ex) => {
        instance.logMessage("warn", `Failed to call ${service}:`, ex);
    });

    instance.clearIssue(ISSUE_KEY);
    if (notify) callService("persistent_notification.dismiss", { notification_id });

    /** Write the latest entities, unless regenerations are over the rate limit */
    const flush = async () => {
        clearTimeout(resume_timer);

        if (counter.count() > max_count) {
            if (!paused) {
                paused = true;
                const message = `Home Assistant entities changed more than ${max_count} times within ${window}; entity type generation (plugin "${instance.id}") is paused until the rate drops`;
                instance.logMessage("warn", message);
                instance.raiseIssue(ISSUE_KEY, "warn", message);
                if (notify) callService("persistent_notification.create", { notification_id, title: "TypeDaemon", message });
            }
            resume_timer = setTimeout(flush, counter.timeUntilAtMost(max_count));
            return;
        }

        if (paused) {
            paused = false;
            instance.logMessage("info", `Entity change rate has dropped; resuming entity type generation`);
            instance.clearIssue(ISSUE_KEY);
            if (notify) callService("persistent_notification.dismiss", { notification_id });
        }

        if (!pending) return;
        const entities = pending;
        pending = null;
        try {
            await saveGeneratedTypes(instance.hypervisor, `ha_entities.${instance.id}`, generateEntityTypes(entities));
        } catch (ex) {
            instance.logMessage("warn", `Failed to write entity types:`, ex);
        }
    }

    const dispose = reaction(
        () => plugin._synced_store.isInitialized ? collectEntities(plugin, config) : null,
        (entities) => {
            if (!entities) return;
            counter.record();
            pending = entities;
            flush();
        },
        { fireImmediately: true, delay: toMs(config.min_interval ?? "30s"), equals: comparer.structural },
    );

    return () => {
        dispose();
        clearTimeout(resume_timer);
    };
}
