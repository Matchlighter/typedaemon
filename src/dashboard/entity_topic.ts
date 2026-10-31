import type { EntityDetail } from "./protocol";
import { replaceTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `entity` topic (see `hypervisorEntitySource`). */
export interface EntitySource {
    /** The entity with `GlobalEntityRow.key` `id`; undefined if unknown */
    get(id: string): Promise<EntityDetail | undefined>;
    /** `cb` fires whenever anything in `get(id)` may have changed */
    onChange(id: string, cb: () => void): () => void;
}

export function entityTopic(source: EntitySource): TopicProvider<'entity'> {
    return replaceTopic({
        subject: 'entity',
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
