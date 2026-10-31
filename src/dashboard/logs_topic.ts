import type { LogRow, LogsParams } from "./protocol";
import type { TopicProvider } from "./topics";

/** Data-source seam of the `logs` topic (see `hypervisorLogsSource`) */
export interface LogsSource {
    /** Oldest first; `limit` keeps the newest */
    history(params: LogsParams): LogRow[];
    /** `cb` gets every matching line written from now on */
    onAppend(params: LogsParams, cb: (row: LogRow) => void): () => void;
}

export interface LogsTopicOptions {
    /** Lines are sent in batches at this interval, so a burst is one message, not thousands */
    flushMs?: number;
}

export function logsTopic(source: LogsSource, { flushMs = 100 }: LogsTopicOptions = {}): TopicProvider<'logs'> {
    return {
        snapshot: (params) => ({ entries: source.history(params ?? {}) }),
        subscribe: (params, emit) => {
            let pending: LogRow[] = [];
            let timer: ReturnType<typeof setTimeout> | undefined;
            const off = source.onAppend(params ?? {}, row => {
                pending.push(row);
                timer ??= setTimeout(() => {
                    timer = undefined;
                    const append = pending;
                    pending = [];
                    emit({ append });
                }, flushMs);
            });
            return () => {
                off();
                clearTimeout(timer);
                pending = [];
            };
        },
    };
}
