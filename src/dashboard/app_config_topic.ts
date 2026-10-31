import type { AppConfigSnapshot } from "./protocol";
import { replaceTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `appConfig` topic (see `hypervisorAppConfigSource`). */
export interface AppConfigSource {
    get(id: string): AppConfigSnapshot | undefined;
    /** `cb` fires whenever anything in `get(id)` may have changed */
    onChange(id: string, cb: () => void): () => void;
}

export function appConfigTopic(source: AppConfigSource): TopicProvider<'appConfig'> {
    return replaceTopic({
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
