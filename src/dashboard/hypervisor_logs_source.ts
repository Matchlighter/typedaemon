import type { Hypervisor } from "../hypervisor/hypervisor";
import { logTap, type LogRecord, type LogTap } from "../hypervisor/log_tap";
import type { LogsSource } from "./logs_topic";
import type { LogLevel, LogRow } from "./protocol";
import { parseStackFrames } from "./stack_frames";

/** What the dashboard needs from the hypervisor (public API only) */
export type LogsHost = Pick<Hypervisor, 'working_directory'>;

const SHOWN_AS_IS = new Set<string>(['debug', 'info', 'warn', 'error', 'lifecycle']);
/** Logger levels below `info` (and the console's `dir`) are all debugging output as far as the dashboard goes */
const DEBUG_LIKE = new Set(['dir', 'http', 'verbose', 'silly']);

const toLevel = (level: string): LogLevel => SHOWN_AS_IS.has(level) ? level as LogLevel : DEBUG_LIKE.has(level) ? 'debug' : 'info';

const FRAME_LINE = /^\s*at /;

/** The tap keeps stack traces inline in the message; the dashboard wants them structured */
export function toLogRow(rec: LogRecord, workingDirectory: string): LogRow {
    const lines = rec.message.split('\n');
    const at = lines.findIndex(l => FRAME_LINE.test(l));
    const frames = at < 0 ? [] : parseStackFrames(lines.slice(at), workingDirectory);
    const row: LogRow = {
        id: rec.id, ts: rec.ts, level: toLevel(rec.level), source: rec.source, channel: rec.channel,
        message: frames.length ? lines.slice(0, at).join('\n') : rec.message,
    };
    if (frames.length) row.stack = frames;
    return row;
}

export function hypervisorLogsSource(host: LogsHost, tap: LogTap = logTap): LogsSource {
    return {
        history: ({ sources, limit }) => tap.history({ sources, limit }).map(r => toLogRow(r, host.working_directory)),
        onAppend: ({ sources }, cb) => tap.on(r => cb(toLogRow(r, host.working_directory)), { sources }),
    };
}
