import type { GlobalEntityRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `entities` topic: says "something may have changed"; the topic works out the delta. */
export interface EntitiesSource {
    list(): Promise<GlobalEntityRow[]>;
    onChange(cb: () => void): () => void;
}

export function entitiesTopic(source: EntitiesSource): TopicProvider<'entities'> {
    return keyedRowsTopic({
        read: async () => ({ rows: await source.list() }),
        onChange: (_params, cb) => source.onChange(cb),
    });
}
