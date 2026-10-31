import type { GlobalResumableRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `resumables` topic: says "something may have changed"; the topic works out the delta. */
export interface ResumablesSource {
    list(): GlobalResumableRow[];
    onChange(cb: () => void): () => void;
}

export function resumablesTopic(source: ResumablesSource): TopicProvider<'resumables'> {
    return keyedRowsTopic({
        read: () => ({ rows: source.list() }),
        onChange: (_params, cb) => source.onChange(cb),
    });
}
