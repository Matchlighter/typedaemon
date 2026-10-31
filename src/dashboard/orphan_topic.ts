import type { OrphanSnapshot } from "./protocol";
import { replaceTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `orphan` topic and `orphan.cleanup` action (see `hypervisorOrphanSource`) */
export interface OrphanSource {
    get(id: string): Promise<OrphanSnapshot>;
    /** Resolves once the orphan is gone; rejects, leaving it in place, if any step failed */
    cleanup(id: string): Promise<void>;
    /** `cb` fires whenever `get(id)` may have changed */
    onChange(id: string, cb: () => void): () => void;
}

export function orphanTopic(source: OrphanSource): TopicProvider<'orphan'> {
    return replaceTopic({
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
