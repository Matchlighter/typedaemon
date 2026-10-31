import type { HttpRouteRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/**
 * Data-source seam of the `appHttp` topic (see `hypervisorAppHttpSource`).
 * The source only says "something may have changed"; the topic works out the delta.
 */
export interface AppHttpSource {
    /** Port of the HTTP plugin; undefined if there is none */
    readonly port: number | undefined;
    /** Current rows; undefined if the app is unknown. An app between instances has none. */
    list(appId: string): HttpRouteRow[] | undefined;
    onChange(appId: string, cb: () => void): () => void;
}

export function appHttpTopic(source: AppHttpSource): TopicProvider<'appHttp'> {
    return keyedRowsTopic({
        read: ({ id }) => { const rows = source.list(id); return rows && { ...(source.port !== undefined && { port: source.port }), rows } },
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
