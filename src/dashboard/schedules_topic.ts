import type { GlobalScheduleRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `schedules` topic: says "something may have changed"; the topic works out the delta. */
export interface SchedulesSource {
    list(): GlobalScheduleRow[];
    onChange(cb: () => void): () => void;
}

export function schedulesTopic(source: SchedulesSource): TopicProvider<'schedules'> {
    return keyedRowsTopic({
        read: () => ({ rows: source.list() }),
        onChange: (_params, cb) => source.onChange(cb),
    });
}
