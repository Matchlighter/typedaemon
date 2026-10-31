/**
 * Admin dashboard wire protocol. SHARED between server (src/dashboard) and the
 * client (dashboard/src, via the `@protocol` alias). Types only: no runtime imports, no node/dom deps (shared unions come from `common/shared_types`).
 *
 * Adding a topic: add an entry to `TopicMap`, then register a provider server-side
 * (`TopicRegistry.register`) and, if the client needs custom delta handling, a reducer client-side.
 */

import type { AppLifecycle, PluginConnectionState, ScheduleKind, StartCause } from '../common/shared_types';

export type { ScheduleKind };

/** Delta of a list of rows identified by a string id: `upsert` replaces/adds rows, `remove` drops ids. Absent lists did not change */
export interface KeyedDelta<R> {
    upsert?: R[];
    remove?: string[];
}

export interface RowsSnapshot<R> {
    rows: R[];
}

/** Topic of a list of keyed rows: the snapshot is `{ rows }`, deltas are `KeyedDelta`s */
export interface RowsTopic<R, P = void> {
    params: P;
    snapshot: RowsSnapshot<R>;
    delta: KeyedDelta<R>;
}

/** Topic name -> its shapes. Extend this for every new topic. */
export interface TopicMap {
    /** Daemon facts, version/uptime and pending cross-app calls; with `params.stores` also the shared stores (System page) */
    system: {
        params: SystemParams | undefined;
        snapshot: SystemSnapshot;
        delta: SystemDelta;
    };
    /** Totals by name (e.g. `entities`) for always-on UI such as nav badges, so it needn't hold a heavy list topic. Every delta is the full, fresh snapshot (replace) */
    counts: {
        params: void;
        snapshot: CountsSnapshot;
        delta: CountsSnapshot;
    };
    apps: {
        params: void;
        snapshot: AppsSnapshot;
        delta: AppsDelta;
    };
    /** Recent notable app transitions (started / died / held stopped), with why a restart happened. Deltas append events */
    lifecycle: {
        params: void;
        snapshot: LifecycleSnapshot;
        delta: LifecycleDelta;
    };
    /** Every configured plugin instance with its live status; rows are keyed by `PluginRow.id` */
    plugins: {
        params: void;
        snapshot: PluginsSnapshot;
        delta: PluginsDelta;
    };
    /** One app's detail page. Every delta is the full, fresh `AppDetail` (replace, don't merge). */
    app: {
        params: { id: string };
        snapshot: AppDetail;
        delta: AppDetail;
    };
    /** What an orphan app (removed from config) left behind. Every delta is the full, fresh snapshot (replace, don't merge) */
    orphan: {
        params: { id: string };
        snapshot: OrphanSnapshot;
        delta: OrphanSnapshot;
    };
    /** One app's entities (HA). Rows are keyed by `EntityRow.key`; a restart drops and recreates them */
    appEntities: RowsTopic<EntityRow, { id: string }>;
    /** Entities of every app (and orphan) at once. Rows are keyed by `GlobalEntityRow.key` */
    entities: RowsTopic<GlobalEntityRow>;
    /** One entity's detail, by `GlobalEntityRow.key`. Every delta is the full, fresh `EntityDetail` (replace, don't merge) */
    entity: {
        params: { id: string };
        snapshot: EntityDetail;
        delta: EntityDetail;
    };
    /** One app's resolved config (after defaults and merges). Every delta is the full, fresh snapshot (replace, don't merge) */
    appConfig: {
        params: { id: string };
        snapshot: AppConfigSnapshot;
        delta: AppConfigSnapshot;
    };
    /** One app's persisted key/value store. Rows are keyed by `StorageRow.key`; deltas carry every change as it is written */
    appStorage: {
        params: { id: string };
        snapshot: AppStorageSnapshot;
        delta: AppStorageDelta;
    };
    /** One app's resumables and scripts. Resumables are keyed by `ResumableRow.key`, scripts by `ScriptRow.key` (their name) */
    appResumables: {
        params: { id: string };
        snapshot: AppResumablesSnapshot;
        delta: AppResumablesDelta;
    };
    /** One app's HTTP routes and static mounts, keyed by `HttpRouteRow.key`. Rows change when the app restarts */
    appHttp: {
        params: { id: string };
        snapshot: AppHttpSnapshot;
        delta: AppHttpDelta;
    };
    /** One app's schedules, keyed by `ScheduleRow.key`. Rows change when the app restarts or a schedule fires */
    appSchedules: RowsTopic<ScheduleRow, { id: string }>;
    /** Schedules of every app at once. Rows are keyed by `GlobalScheduleRow.key` */
    schedules: RowsTopic<GlobalScheduleRow>;
    /** Resumables (and suspend-script runs) of every app at once. Rows are keyed by `GlobalResumableRow.key` */
    resumables: RowsTopic<GlobalResumableRow>;
    /**
     * Log lines: history, then live. Any mix of sources, so one topic serves the per-app Logs tab and the global
     * Logs view. Filtering by level/channel/text is the client's business. Deltas may repeat lines the snapshot has: dedupe by `LogRow.id`
     */
    logs: {
        params: LogsParams;
        snapshot: LogsSnapshot;
        delta: LogsDelta;
    };
}

/**
 * Action name -> params. One-shot commands (client `call` -> server `result`), as opposed to topics.
 * Extend this, then `ActionRegistry.register` server-side and `connection.call(name, params)` client-side.
 */
export interface ActionMap {
    'app.restart': { id: string };
    'app.stop': { id: string };
    'app.start': { id: string };
    /**
     * Clean up an orphan: run its destroyers (eg remove its entities from HA), then delete its operating directory.
     * Rejects with the reason if anything failed, leaving the orphan listed. Never touches the app's source or the config.
     */
    'orphan.cleanup': { id: string };
    /** Drop and re-establish a plugin's connection. Rejects when the plugin is not running or cannot reconnect */
    'plugin.reconnect': { id: string };
    /** Delete an unlinked entity from HA and the app's autoclean registry. `key` is `EntityRow.key` */
    'entity.delete': { app: string; key: string };
    /** Remove a key from the app's store only: a running app keeps its in-memory value until it writes again or restarts */
    'storage.delete': { app: string; key: string };
    /** Full value of a key of a shared store whose row was sent as `lazy` */
    'sharedStorage.value': { store: string; key: string };
    /** Full value of a key whose row was sent as `lazy` */
    'storage.value': { app: string; key: string };
    /** Stop a running resumable. `key` is `ResumableRow.key` */
    'resumable.cancel': { app: string; key: string };
    /** Forget a resumable that failed to resume, so it is not retried at the next start */
    'resumable.discard': { app: string; key: string };
    /** Stop a running script run. `script` is `ScriptRow.key`, `run` is `ScriptRunRow.id` */
    'script.cancel': { app: string; script: string; run: string };
    /** Give up a cross-app call still waiting for its target: the caller's promise rejects. Rejects when the call has started or is gone. `uuid` is `CrossCallRow.uuid` */
    'crossCall.cancel': { uuid: string };
}
/** What an action hands back to the caller; actions not listed here return nothing */
export interface ActionResultMap {
    'storage.value': unknown;
    'sharedStorage.value': unknown;
}
export type ActionResult<N extends ActionName> = N extends keyof ActionResultMap ? ActionResultMap[N] : void;
export type ActionName = keyof ActionMap;
export type ActionParams<N extends ActionName> = ActionMap[N];

export type TopicName = keyof TopicMap;
export type TopicParams<T extends TopicName> = TopicMap[T]['params'];
export type TopicSnapshot<T extends TopicName> = TopicMap[T]['snapshot'];
export type TopicDelta<T extends TopicName> = TopicMap[T]['delta'];

export interface SystemParams {
    /** Include `SystemSnapshot.stores`. Off by default: values are inlined (up to 32KB each) and resent on any store write */
    stores?: boolean;
}

/** Total per name; a name whose count could not be read is absent */
export type CountsSnapshot = Record<string, number>;

export interface SystemSnapshot {
    version: string;
    /** Node.js runtime version, e.g. `22.11.0` */
    nodeVersion: string;
    /** epoch ms */
    startedAt: number;
    /** epoch ms (server clock) */
    now: number;
    /** Where a browser can open Home Assistant, if known (the HA plugin asks HA once connected) */
    haBaseUrl?: string;
    state: 'running' | 'shutting_down';
    /** Absolute path of the loaded config file */
    configPath?: string;
    location?: { latitude?: number; longitude?: number; elevation?: number; timezone?: string };
    /** The loaded config, read-only: secrets hidden, `plugins`/`apps` reduced to their ids */
    resolvedConfig?: Record<string, unknown>;
    crossCalls: CrossCallRow[];
    /** Only with `SystemParams.stores` */
    stores?: SharedStoreRow[];
}
/** The periodic `{ now }` tick merges into the snapshot; any other delta is a full, fresh snapshot (replace, so cleared fields clear) */
export type SystemDelta = { now: number } | SystemSnapshot;

/** A store shared by all apps */
export interface SharedStoreRow {
    name: string;
    /** Store file, relative to the working directory */
    path: string;
    /** Ids of apps that accessed the store since the hypervisor started */
    usedBy: string[];
    rows: StorageRow[];
}

/** A persisted cross-app call that has not completed. `source`/`target` are app ids */
export interface CrossCallRow {
    uuid: string;
    source: string;
    target: string;
    method: string;
    /** `pending`: waiting for the target to run it. `started`: running in the target. `returning`: done, waiting for the source to pick up the result */
    status: 'pending' | 'started' | 'returning';
    /** epoch ms the call was made; absent on calls persisted by older versions */
    since?: number;
    /** epoch ms a pending call gives up if the target has not started it */
    timeoutAt?: number;
    /** The target's current state; absent when no such app exists (any more) */
    targetState?: AppState;
    /** Call arguments as JSON text (comma separated, no brackets), cut at 200 chars; absent when the call has none */
    args?: string;
}

export type AppState = AppLifecycle;

export interface AppRow {
    /** Config key; stable across restarts (a restart is a new instance, not a new row) */
    id: string;
    /** `human_name` or id */
    name: string;
    /** Source path relative to the working directory */
    source: string;
    /** Absent when no instance exists yet to ask */
    kind?: 'thick' | 'lite';
    state: AppState;
    /** epoch ms the app entered `state` (uptime for `started`, time-of-death for `dead`) */
    since: number;
    /** Stopped from the dashboard: stays stopped until started again or the next config reload */
    stoppedOverride?: true;
    /** Why the last start failed, and in which phase; set while `dead` */
    error?: { message: string; phase: AppState };
    /** Counts are omitted while their source has no data (not yet exposed by every subsystem) */
    resumables?: number;
    /** Resumables that failed to resume (retried at every start); omitted when none */
    failedResumes?: number;
    entities?: number;
    /** Entities registered in HA but no longer declared by the app; omitted when none */
    unlinkedEntities?: number;
    schedules?: number;
}

export interface ErrorFrame {
    fn?: string;
    /** Source-mapped; relative to the working directory when inside it */
    file: string;
    line: number;
    col?: number;
}

/** Source lines around the failing frame; `col` (1-based) places the caret */
export interface CodeFrame {
    file: string;
    line: number;
    col?: number;
    lines: { n: number; text: string }[];
}

/** Everything the app detail page shows, beyond the list row */
/** What the overview cards say beneath their numbers; each part is omitted while its source has nothing to say */
export interface AppSummary {
    /** Soonest pending schedule */
    nextSchedule?: { expression: string; /** epoch ms */ at: number };
    storage?: { /** Serialized bytes of the user keys */ bytes: number; /** Internal keys, not counted in `counts.storage` */ internal: number; /** epoch ms of the newest write this run */ lastWriteAt?: number };
    /** Scripts with a running run, by name, and runs waiting their turn */
    scripts?: { running: string[]; queued: number };
    /** Ids of the plugins the app has used so far */
    dependsOn?: string[];
}

export interface AppDetail {
    row: AppRow;
    uuid: string;
    /** `source#export`, e.g. `apps/lights/index.ts#default` */
    instanceOf: string;
    logLevel?: string;
    /** npm packages declared in the app config */
    packages: Record<string, string>;
    /** Config changes / source saves restart the app */
    watching: boolean;
    /** Set while the app is dead */
    failure?: {
        message: string; phase: AppState; frames: ErrorFrame[]; codeFrame?: CodeFrame;
        /** `LogRow.id` of the log line that reported the failure; absent when none was found. May have left the log buffer */
        logId?: number;
    };
    /** Per-subsystem counts for the overview cards and tab labels; omitted until their source exposes them */
    /** Sub-lines of the overview cards and the Details card */
    summary?: AppSummary;
    counts: { entities?: number; unlinkedEntities?: number; schedules?: number; http?: number; storage?: number; resumables?: number; /** Running script runs */ scripts?: number };
}

/** Link state of a plugin to the thing it talks to. Absent when the plugin has no such link (or nothing to measure yet) */
export type PluginConnection = PluginConnectionState;

/** Why an app instance was replaced by a new one; absent on a plain start */
export type LifecycleCause = StartCause;

export interface LifecycleEvent {
    /** Increases with every event until the server restarts */
    id: number;
    /** epoch ms */
    ts: number;
    /** App id */
    app: string;
    /** `human_name` or id */
    name: string;
    /** Lifecycle step entered, or `orphan` (removed from config, leftovers kept) / `resumed` (picked up suspended resumables at start) */
    state: AppState | 'orphan' | 'resumed';
    /** Lifecycle step the app was in before this one (transitional steps included); absent for the first step seen */
    from?: AppState;
    cause?: LifecycleCause;
    /** What specifically triggered a restart (`Source changed: apps/x/index.ts`); set with `cause` where known */
    detail?: string;
    /** Names of the resumables picked up; set with `resumed` */
    resumed?: string[];
    /** Why it died; set with `dead` */
    error?: string;
    /** `LogRow.id` of the log line that reported the failure (set with `error`); absent when none was found. May have left the log buffer */
    errorLogId?: number;
}
export interface LifecycleSnapshot {
    /** Oldest first */
    events: LifecycleEvent[];
}
export interface LifecycleDelta {
    append: LifecycleEvent[];
}

export interface PluginRow {
    /** Config key; stable across restarts */
    id: string;
    /** `home_assistant`, `mqtt`, `http`... */
    type: string;
    /** Lifecycle of the instance; `stopped` when configured but not running */
    state: AppState;
    /** epoch ms the plugin entered `state` */
    since: number;
    connection?: PluginConnection;
    /** What it connects to (HA url, MQTT broker) or listens on (`:9000`); credentials removed */
    target?: string;
    logLevel?: string;
    /** Plugin-specific status lines (`Routes` / `2 routes`); absent when the plugin has none */
    summary?: { label: string; value: string }[];
    /** Ids of the running apps that use this plugin; absent when none do */
    usedBy?: string[];
    /** The plugin's config, secrets hidden */
    config: unknown;
}

export interface PluginsSnapshot {
    plugins: PluginRow[];
}
export type PluginsDelta = KeyedDelta<PluginRow>;

export interface EntityRow {
    /** Stable across restarts: `<plugin id>:<registry key>` */
    key: string;
    /** Id of the home_assistant plugin the entity lives in */
    plugin: string;
    domain: string;
    name?: string;
    /** HA's entity_id; unknown until HA's registry knows the entity (TD only knows its unique id) */
    entityId?: string;
    /** Current HA state */
    state?: string;
    /** Registered by the running app; otherwise only remembered by the autoclean registry */
    linked: boolean;
    autoClean: boolean;
    persistState: boolean;
}

export type AppEntitiesSnapshot = RowsSnapshot<EntityRow>;
export type AppEntitiesDelta = KeyedDelta<EntityRow>;

/** An entity of any app. `key` is unique across apps; `entityKey` is the app-local `EntityRow.key` (what `entity.delete` takes) */
export interface GlobalEntityRow extends EntityRow {
    app: string;
    entityKey: string;
    /** The app has left the config: its entities are only remembered by the leftovers in its operating directory */
    orphan?: boolean;
}

/** An entity's row plus its live HA state (absent while HA's registry doesn't know the entity or has no state for it) */
export interface EntityDetail extends GlobalEntityRow {
    attributes?: Record<string, unknown>;
    /** ISO times from HA's state object */
    lastChanged?: string;
    lastUpdated?: string;
}

export type EntitiesSnapshot = RowsSnapshot<GlobalEntityRow>;
export type EntitiesDelta = KeyedDelta<GlobalEntityRow>;

/** Shape of an object/array value that was not sent (see `StorageRow.lazy`) */
export interface LazyMeta {
    kind: 'object' | 'array';
    count: number;
    /** Serialized bytes */
    size: number;
}

export interface StorageRow {
    key: string;
    /** The JSON value; absent when `lazy` */
    value?: unknown;
    /** Value too large to push: only its shape is sent, fetch the rest with the `storage.value` action */
    lazy?: LazyMeta;
    /** Serialized bytes */
    size: number;
    /** epoch ms of the last write (the store file's mtime if not written during this run) */
    writtenAt: number;
    /** TypeDaemon bookkeeping rather than user data */
    internal: boolean;
}

export interface AppStorageSnapshot {
    /** Store file, relative to the working directory */
    path: string;
    rows: StorageRow[];
}
export type AppStorageDelta = KeyedDelta<StorageRow>;

export type ResumableWaitRow =
    | { kind: 'sleep'; until: number }
    | { kind: 'condition'; condition: string; since: number };

/** A `@resumable` call or `@script({ shutdown: 'suspend' })` run */
export interface ResumableRow {
    /** Unique for as long as the resumable lives (not stable across app restarts) */
    key: string;
    /** `suspended`: waiting on disk for the app to start again */
    status: 'running' | 'suspended' | 'failed';
    type: 'resumable' | 'script';
    owner: string;
    method: string;
    params: unknown[];
    wait?: ResumableWaitRow;
    /** epoch ms of the original call */
    startedAt: number;
    /** App restarts survived */
    restarts: number;
    /** Set when `status` is `failed`: why it could not be resumed, and how many starts tried */
    failure?: { error: string; attempts: number };
}

/** A resumable of any app. `key` is unique across apps; `resumableKey` is the per-app `ResumableRow.key` the actions take */
export interface GlobalResumableRow extends ResumableRow {
    app: string;
    resumableKey: string;
}

export interface ScriptRunRow {
    /** Unique for as long as the run exists */
    id: string;
    params: unknown[];
    /** epoch ms the run was queued (or started, if running) */
    startedAt: number;
    queued: boolean;
}

export interface ScriptRow {
    /** The script's name */
    key: string;
    mode: 'single' | 'restart' | 'queued' | 'parallel';
    /** Most runs (running + queued) per call key; null for no limit */
    limit: number | null;
    running: number;
    queued: number;
    runs: ScriptRunRow[];
}

export interface AppResumablesSnapshot {
    resumables: ResumableRow[];
    scripts: ScriptRow[];
}
export interface AppResumablesDelta {
    resumables?: KeyedDelta<ResumableRow>;
    scripts?: KeyedDelta<ScriptRow>;
}

/** One `@schedule` / `run_every` / `run_in` / `run_at` registration */
export interface ScheduleRow {
    /** Unique for as long as the schedule is registered (not stable across app restarts) */
    key: string;
    /** As the app wrote it (`MON-FRI 6:45 AM`, `run_every('5m')`) */
    expression: string;
    kind: ScheduleKind;
    /** Name of the callback */
    method: string;
    /** epoch ms of the next fire; absent when nothing is pending */
    nextAt?: number;
    lastAt?: number;
    lastResult?: 'ok' | 'error';
    /** How long the last run of the callback took */
    lastDurationMs?: number;
}

/** A schedule of any app. `key` is unique across apps (`<app>/<ScheduleRow.key>`) */
export interface GlobalScheduleRow extends ScheduleRow {
    app: string;
}

export type AppSchedulesSnapshot = RowsSnapshot<ScheduleRow>;
export type AppSchedulesDelta = KeyedDelta<ScheduleRow>;

export interface AppConfigSnapshot {
    /** The effective config: what the app runs with, not what the file says */
    config: unknown;
    /** Paths into `config` (object keys) whose value the config file did not give; the highest such paths only */
    defaults: string[][];
    /** Config file the app is configured in */
    file?: string;
    /** 1-based line of the app's entry in `file`; best effort */
    line?: number;
}

/** One route or static mount an app registered on the HTTP plugin */
export interface HttpRouteRow {
    /** Unique for as long as the route is registered (not stable across app restarts) */
    key: string;
    kind: 'route' | 'static';
    /** Upper case (`ALL` for any); routes only */
    method?: string;
    /** As the app wrote it, relative to the app's URL root */
    path: string;
    /** Handler function name (routes) or directory served, relative to the working directory (static) */
    handler: string;
    /** Absolute path on the HTTP server (`/app/<uuid>/...`); prefix it with the server's origin */
    url: string;
}

export interface AppHttpSnapshot {
    /** Port the HTTP plugin listens on; absent when there is no HTTP plugin */
    port?: number;
    rows: HttpRouteRow[];
}
export type AppHttpDelta = KeyedDelta<HttpRouteRow>;

/** Who wrote a log line. `system`: TypeDaemon itself */
export interface LogSourceRef {
    kind: 'app' | 'plugin' | 'system';
    id: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'lifecycle';

export interface LogRow {
    /** Increases with every line, across all sources, until the server restarts */
    id: number;
    /** epoch ms */
    ts: number;
    level: LogLevel;
    source: LogSourceRef;
    /** `user`: what the app logged; `manager`: what TypeDaemon logged about it */
    channel: 'user' | 'manager';
    /** Without the stack trace */
    message: string;
    /** Source-mapped */
    stack?: ErrorFrame[];
}

export interface LogsParams {
    /** Only these sources; all of them when omitted */
    sources?: LogSourceRef[];
    /** Most history lines in the snapshot (the newest); the server's whole buffer when omitted */
    limit?: number;
}

export interface LogsSnapshot {
    /** Oldest first */
    entries: LogRow[];
}
export interface LogsDelta {
    /** Oldest first */
    append: LogRow[];
}

/** App removed from config whose operating dir (and so possibly entities/destroyers) is still on disk */
export interface OrphanRow {
    id: string;
    /** Absent when the leftovers could not be read (eg cleaned up meanwhile) */
    summary?: OrphanSummary;
}

/** The size of an orphan's leftovers: enough for a list row (`OrphanLeftovers` has the detail) */
export interface OrphanSummary {
    /** When the app left the config (as recorded by TypeDaemon); for apps removed while it was not running, approximated by the operating directory's last change */
    removedAt: number;
    /** Entities still in Home Assistant, as far as the autoclean registry knows */
    entities: number;
    storageKeys: number;
    dirBytes: number;
    /** Destroyer class names, in run order */
    destroyers: string[];
}

/** A cleanup job an orphan registered while it ran (`DestroyerStore`) */
export interface OrphanDestroyerRow {
    uuid: string;
    /** Destroyer class, eg `HAEntities` */
    type: string;
    options: unknown;
}

/** Everything an orphan left behind: what a cleanup deletes or releases */
export interface OrphanLeftovers {
    dir: {
        /** Relative to the working directory */
        path: string;
        bytes: number;
        files: number;
    };
    /** Persisted keys (all of them, internal ones flagged) */
    storage: StorageRow[];
    /** Entities still in Home Assistant, as far as the app's autoclean registry knows */
    entities: EntityRow[];
    /** Run by a cleanup, in this order */
    destroyers: OrphanDestroyerRow[];
}

export interface OrphanSnapshot {
    id: string;
    /** Absent when `id` has no leftovers: never was an orphan, or was cleaned up (or is back in the config) */
    leftovers?: OrphanLeftovers;
}

export interface AppsSnapshot {
    apps: AppRow[];
    orphans: OrphanRow[];
}
/** `orphans` replaces the whole orphan list */
export interface AppsDelta extends KeyedDelta<AppRow> {
    orphans?: OrphanRow[];
}

/** client -> server */
export type ClientMessage =
    | { type: 'subscribe'; id: number; topic: string; params?: unknown }
    | { type: 'unsubscribe'; id: number }
    | { type: 'call'; id: number; action: string; params?: unknown };

/** server -> client. `id` is the client-chosen subscription id. */
export type ServerMessage =
    | { type: 'snapshot'; id: number; data: unknown }
    | { type: 'delta'; id: number; data: unknown }
    | { type: 'error'; id: number; message: string }
    | { type: 'result'; id: number; ok: true; data?: unknown }
    | { type: 'result'; id: number; ok: false; message: string };
