import type { AppStorageSnapshot } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/**
 * Data-source seam of the `appStorage` topic (see `hypervisorAppStorageSource`).
 * The source only says "something may have changed"; the topic works out the delta.
 */
export interface AppStorageSource {
    /** Current store; undefined if the app is unknown */
    get(appId: string): AppStorageSnapshot | undefined | Promise<AppStorageSnapshot | undefined>;
    onChange(appId: string, cb: () => void): () => void;
}

export function appStorageTopic(source: AppStorageSource): TopicProvider<'appStorage'> {
    return keyedRowsTopic({
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
