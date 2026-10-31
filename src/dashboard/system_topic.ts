import type { SystemParams, SystemSnapshot } from "./protocol";
import type { TopicProvider } from "./topics";

/** The daemon's live facts: everything in the snapshot but the static `version`/`startedAt` and the ticking `now` */
export type SystemFacts = Omit<SystemSnapshot, 'version' | 'nodeVersion' | 'startedAt' | 'now'>;

/**
 * Data-source seam of the `system` topic (see `hypervisorSystemSource`).
 * The source only says "something may have changed"; the topic re-reads and sends the whole snapshot.
 */
export interface SystemSource {
    /** `stores`: include the (heavy) shared stores */
    get(stores: boolean): SystemFacts | Promise<SystemFacts>;
    onChange(cb: () => void): () => void;
}

/**
 * Version/uptime plus the daemon's live facts. Deltas are a periodic `{ now }` tick and, on change, the full fresh snapshot.
 * `coalesceMs`: shared stores can be written in bursts; they become one delta
 */
export function systemTopic(
    info: { version: string; nodeVersion: string; startedAt: number },
    source: SystemSource,
    { intervalMs = 5000, coalesceMs = 250 } = {},
): TopicProvider<'system'> {
    const wantsStores = (params: SystemParams | undefined) => !!params?.stores;
    return {
        snapshot: async params => ({ ...info, now: Date.now(), ...await source.get(wantsStores(params)) }),
        subscribe: (params, emit) => {
            const ticker = setInterval(() => emit({ now: Date.now() }), intervalMs);
            let timer: ReturnType<typeof setTimeout> | undefined;
            // Lifecycle events fire often but rarely change what is shown; don't resend identical (value-carrying) snapshots
            let last: string | undefined;
            Promise.resolve(source.get(wantsStores(params))).then(f => { last ??= JSON.stringify(f) }, () => { });
            const off = source.onChange(() => {
                if (timer) return;
                timer = setTimeout(async () => {
                    timer = undefined;
                    try {
                        const next = await source.get(wantsStores(params));
                        const json = JSON.stringify(next);
                        if (json === last) return;
                        last = json;
                        emit({ ...info, now: Date.now(), ...next });
                    } catch { /* next change retries */ }
                }, coalesceMs);
            });
            return () => {
                clearInterval(ticker);
                off();
                if (timer) clearTimeout(timer);
                timer = undefined;
            };
        },
    };
}
