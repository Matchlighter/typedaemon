import type { LifecycleEvent } from "./protocol";
import type { TopicProvider } from "./topics";

/** Data-source seam of the `lifecycle` topic: a bounded history plus a live stream of new events. */
export interface LifecycleSource {
    /** Oldest first */
    recent(): LifecycleEvent[];
    onEvent(cb: (event: LifecycleEvent) => void): () => void;
}

export function lifecycleTopic(source: LifecycleSource): TopicProvider<'lifecycle'> {
    return {
        snapshot: () => ({ events: source.recent() }),
        subscribe: (_params, emit) => source.onEvent(event => emit({ append: [event] })),
    };
}
