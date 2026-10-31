import type { AppDetail } from "./protocol";
import { replaceTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `app` topic (see `hypervisorAppDetailSource`). */
export interface AppDetailSource {
    get(id: string): AppDetail | undefined;
    /** `cb` fires whenever anything in `get(id)` may have changed */
    onChange(id: string, cb: () => void): () => void;
}

export function appTopic(source: AppDetailSource): TopicProvider<'app'> {
    return replaceTopic({
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
