/**
 * Unions shared by the server and the dashboard wire protocol (`dashboard/protocol.ts`).
 * Dependency-free on purpose: the client typechecks protocol.ts, so this must not import server code.
 */

export type AppLifecycle = 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

/** Why an instance was restarted (absent on a plain start) */
export type StartCause = 'manual' | 'source_change' | 'config_change' | 'plugin_started';

/** Link state of a plugin to the thing it talks to (shown in the dashboard) */
export type PluginConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'listening';

export type ScheduleKind = 'sun' | 'cron' | 'interval' | 'at';
