import { ObservableRegistry } from "../../common/observable_registry";
import type { ScheduleKind } from "../../common/shared_types";

export type { ScheduleKind };

export interface ScheduleDefinition {
    /** As the app wrote it (`MON-FRI 6:45 AM`, `run_every('5m')`) */
    expression: string;
    kind: ScheduleKind;
    /** Name of the callback */
    method: string;
}

export interface ScheduleInfo extends ScheduleDefinition {
    id: number;
    /** epoch ms of the next fire; absent when nothing is pending */
    nextAt?: number;
    lastAt?: number;
    lastResult?: 'ok' | 'error';
    /** How long the last run of the callback took */
    lastDurationMs?: number;
}

/** What the scheduler uses to keep its registration up to date */
export interface ScheduleTracker {
    /** The schedule is now waiting for `at` (undefined: nothing pending) */
    armed(at: Date | undefined): void;
    /** The callback ran (or threw) just now */
    fired(result: 'ok' | 'error', durationMs?: number): void;
    /** The schedule is gone */
    remove(): void;
}

/**
 * The schedules an app has registered and what they are up to. Timers are only cleanup closures, so this
 * is the one place that can tell what an app has scheduled.
 */
export class ScheduleRegistry extends ObservableRegistry<ScheduleInfo> {
    add(def: ScheduleDefinition): ScheduleTracker {
        const { update, remove } = this.register(def);
        return {
            armed: at => update({ nextAt: at?.getTime() }),
            fired: (lastResult, lastDurationMs) => update({ lastAt: Date.now(), lastResult, lastDurationMs }),
            remove,
        };
    }
}
