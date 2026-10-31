import type { EntityRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/**
 * Data-source seam of the `appEntities` topic (see `hypervisorAppEntitiesSource`).
 * The source only says "something may have changed"; the topic works out the delta.
 */
export interface AppEntitiesSource {
    /** Current rows; undefined if the app is unknown. An app between instances has none. */
    list(appId: string): EntityRow[] | undefined;
    onChange(appId: string, cb: () => void): () => void;
}

export function appEntitiesTopic(source: AppEntitiesSource): TopicProvider<'appEntities'> {
    return keyedRowsTopic({
        read: ({ id }) => { const rows = source.list(id); return rows && { rows } },
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
