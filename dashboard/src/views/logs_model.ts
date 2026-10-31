import type { LogLevel, LogRow, LogSourceRef, LogsDelta, LogsSnapshot } from '@protocol';
import type { LogEntry } from '../components/LogLine';

export const ALL_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'lifecycle'];
/** Levels shown by default (debug is noisy, opt-in) */
export const DEFAULT_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error', 'lifecycle'];
export type LogSourceKind = LogSourceRef['kind'];
export const ALL_KINDS: readonly LogSourceKind[] = ['system', 'plugin', 'app'];
export type ChannelFilter = 'both' | 'user' | 'manager';

export interface LogFilters {
    channel: ChannelFilter;
    /** Levels that are shown */
    levels: readonly LogLevel[];
    search: string;
    /** Source kinds that are shown (all when omitted) */
    kinds?: readonly LogSourceKind[];
}

/** Most lines the client keeps per subscription (the oldest go first) */
export const LOG_BUFFER = 10_000;

/** Fold a `logs` delta into the snapshot, keeping at most `cap` lines. Lines at or before the last one we have are repeats */
export const applyLogsDelta = (cur: LogsSnapshot, d: LogsDelta, cap: number = LOG_BUFFER): LogsSnapshot => {
    const lastId = cur.entries.length ? cur.entries[cur.entries.length - 1].id : -Infinity;
    const fresh = d.append.filter(r => r.id > lastId);
    if (!fresh.length) return cur;
    const entries = [...cur.entries, ...fresh];
    return { entries: entries.length > cap ? entries.slice(entries.length - cap) : entries };
};

const haystack = (r: LogRow) => `${r.message}\n${r.source.id}\n${r.stack?.map(f => f.file).join('\n') ?? ''}`;

/** Search box text -> line matcher. `/pattern/` (optional `i`/`s`/`m`/`g`-free flags) is a regex (case-insensitive unless flags given); an invalid regex, or anything else, is a case-insensitive substring. Empty -> matches all */
export function searchMatcher(search: string): (text: string) => boolean {
    const q = search.trim();
    const m = /^\/(.+)\/([imsu]*)$/.exec(q);
    if (m) {
        try {
            const re = new RegExp(m[1], m[2] || 'i');
            return t => re.test(t);
        } catch { /* not a valid regex: search it literally */ }
    }
    const needle = q.toLowerCase();
    return t => !needle || t.toLowerCase().includes(needle);
}

export function filterLogs(rows: readonly LogRow[], f: LogFilters): LogRow[] {
    const matches = searchMatcher(f.search);
    return rows.filter(r =>
        (f.channel === 'both' || r.channel === f.channel)
        && f.levels.includes(r.level)
        && (!f.kinds || f.kinds.includes(r.source.kind))
        && matches(haystack(r)));
}

export function lastError(rows: readonly LogRow[]): LogRow | undefined {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].level === 'error') return rows[i];
    return undefined;
}

/** `app:lights`, `plugin:mqtt`, `system`; manager-channel app lines get a ` (td)` suffix */
export const logSourceLabel = (r: LogRow): string => {
    const { kind, id } = r.source;
    if (kind === 'system') return 'system';
    return `${kind}:${id}${r.channel === 'manager' && kind === 'app' ? ' (td)' : ''}`;
};

/** For a lifecycle line right after an error from the same source (eg "dead"), the id of that error */
export function causeIdAt(rows: readonly LogRow[], i: number): number | undefined {
    const r = rows[i], prev = rows[i - 1];
    return r?.level === 'lifecycle' && prev?.level === 'error' && prev.source.kind === r.source.kind && prev.source.id === r.source.id ? prev.id : undefined;
}

export function toLogEntry(r: LogRow, causeId?: number): LogEntry {
    return {
        ts: r.ts, level: r.level, message: r.message, stack: r.stack, causeId,
        source: logSourceLabel(r),
    };
}

/** The lines as newline-delimited JSON (one `LogRow` per line), oldest first - for download */
export const logsAsNdjson = (rows: readonly LogRow[]): string => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
