import WinstonTransport from "winston-transport";

/** Who a log record belongs to. `system`: the hypervisor itself (and logs from no known context) */
export interface LogSource {
    kind: 'app' | 'plugin' | 'system';
    id: string;
}

/** `user`: the app's own logs; `manager`: TypeDaemon's logs about the app */
export type LogChannel = 'user' | 'manager';

export interface LogRecord {
    /** Increasing for the life of the process, across all sources */
    id: number;
    /** epoch ms */
    ts: number;
    /** Level name as the logger used it (winston levels, `lifecycle`, ...) */
    level: string;
    source: LogSource;
    channel: LogChannel;
    /** Plain text (no colors); stack traces are inline, source-mapped */
    message: string;
}

export interface LogFilter {
    /** Only these sources; every source when omitted */
    sources?: LogSource[];
}

export interface LogTapOptions {
    /** Records kept per source (oldest dropped first) */
    perSource?: number;
    /** Message bytes (UTF-8) kept per source; oldest dropped first, newest record always kept */
    maxBytesPerSource?: number;
    /** Longest message kept, in chars */
    maxMessage?: number;
}

const sourceKey = (s: LogSource) => `${s.kind}:${s.id}`;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * In-process tap on everything the loggers write: a ring buffer per source (so a noisy source cannot
 * push out a quiet one) plus a live feed. Backs the dashboard's log topic; any consumer can filter by source.
 */
export class LogTap {
    private buffers = new Map<string, { source: LogSource; entries: Array<{ record: LogRecord; bytes: number }>; bytes: number }>();
    private listeners = new Set<{ cb: (r: LogRecord) => void; keys?: Set<string> }>();
    private nextId = 1;
    private readonly perSource: number;
    private readonly maxBytes: number;
    private readonly maxMessage: number;

    constructor(opts: LogTapOptions = {}) {
        this.perSource = opts.perSource ?? 5000;
        this.maxBytes = opts.maxBytesPerSource ?? 2 * 1024 * 1024;
        this.maxMessage = opts.maxMessage ?? 20_000;
    }

    append(rec: Omit<LogRecord, 'id'>): LogRecord {
        const message = rec.message.length > this.maxMessage ? rec.message.slice(0, this.maxMessage) + '… (truncated)' : rec.message;
        const record: LogRecord = { ...rec, message, id: this.nextId++ };
        const key = sourceKey(rec.source);
        let buf = this.buffers.get(key);
        if (!buf) this.buffers.set(key, buf = { source: rec.source, entries: [], bytes: 0 });
        const bytes = Buffer.byteLength(message);
        buf.entries.push({ record, bytes });
        buf.bytes += bytes;
        this.trim(buf);
        for (const l of this.listeners) if (!l.keys || l.keys.has(key)) l.cb(record);
        return record;
    }

    /** Drops the oldest records over the byte budget (exact; the newest record always stays) or the count limit (amortized: may overshoot by half) */
    private trim(buf: { entries: Array<{ bytes: number }>; bytes: number }) {
        const { entries } = buf;
        let cut = 0;
        while (buf.bytes > this.maxBytes && cut < entries.length - 1) buf.bytes -= entries[cut++].bytes;
        if (entries.length - cut > this.perSource * 1.5) {
            for (const end = entries.length - this.perSource; cut < end;) buf.bytes -= entries[cut++].bytes;
        }
        if (cut) entries.splice(0, cut);
    }

    /** Oldest first. `limit` keeps the newest */
    history(opts: LogFilter & { limit?: number } = {}): LogRecord[] {
        const keys = opts.sources && new Set(opts.sources.map(sourceKey));
        const parts = [...this.buffers].filter(([k]) => !keys || keys.has(k)).map(([, b]) => b.entries.slice(-this.perSource).map(e => e.record));
        const all = parts.length === 1 ? parts[0] : parts.flat().sort((a, b) => a.id - b.id);
        return opts.limit !== undefined && all.length > opts.limit ? all.slice(all.length - opts.limit) : all;
    }

    /** Id of the newest record appended so far (0: none yet). Pair with `findLast`'s `afterId` to scope a search to "since now" */
    get lastId() { return this.nextId - 1 }

    /** The newest retained record that satisfies `match`, among the given sources (all if omitted) and with an id above `afterId` */
    findLast(opts: LogFilter & { afterId?: number; match?: (r: LogRecord) => boolean } = {}): LogRecord | undefined {
        const { afterId = 0, match } = opts;
        const all = this.history(opts);
        for (let i = all.length - 1; i >= 0 && all[i].id > afterId; i--) if (!match || match(all[i])) return all[i];
        return undefined;
    }

    /** Forget a source's retained records (eg its app was removed). Live listeners are unaffected */
    drop(source: LogSource) {
        this.buffers.delete(sourceKey(source));
    }

    /** `cb` gets every record appended from now on (of the given sources, if any). Returns an unsubscribe fn */
    on(cb: (r: LogRecord) => void, filter: LogFilter = {}): () => void {
        const l = { cb, keys: filter.sources && new Set(filter.sources.map(sourceKey)) };
        this.listeners.add(l);
        return () => { this.listeners.delete(l) };
    }
}

/** The process-wide tap; every logger from `createDomainLogger` with a `source` writes here */
export const logTap = new LogTap();

/** winston transport feeding a `LogTap` */
export class TapTransport extends WinstonTransport {
    constructor(private readonly tap: LogTap, private readonly source: LogSource, private readonly channel: LogChannel) {
        super();
    }

    log(info: any, next: () => void) {
        const parsed = info.timestamp ? Date.parse(info.timestamp) : NaN;
        this.tap.append({
            ts: Number.isNaN(parsed) ? Date.now() : parsed,
            level: String(info.level).replace(ANSI, ''),
            source: this.source,
            channel: this.channel,
            message: String(info.message).replace(ANSI, ''),
        });
        next();
    }
}
