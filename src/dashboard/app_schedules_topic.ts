import type { ScheduleRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/**
 * Data-source seam of the `appSchedules` topic (see `hypervisorAppSchedulesSource`).
 * The source only says "something may have changed"; the topic works out the delta.
 */
export interface AppSchedulesSource {
    /** Current rows; undefined if the app is unknown. An app between instances has none. */
    list(appId: string): ScheduleRow[] | undefined;
    onChange(appId: string, cb: () => void): () => void;
}

export function appSchedulesTopic(source: AppSchedulesSource): TopicProvider<'appSchedules'> {
    return keyedRowsTopic({
        read: ({ id }) => { const rows = source.list(id); return rows && { rows } },
        onChange: ({ id }, cb) => source.onChange(id, cb),
    });
}
