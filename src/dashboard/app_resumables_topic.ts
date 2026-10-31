import { diffKeyedRows } from "./keyed_rows";
import type { AppResumablesDelta, AppResumablesSnapshot } from "./protocol";
import { diffTopic, type TopicProvider } from "./topics";

/**
 * Data-source seam of the `appResumables` topic (see `hypervisorAppResumablesSource`).
 * The source only says "something may have changed"; the topic works out the delta.
 */
export interface AppResumablesSource {
    /** Current state; undefined if the app is unknown. An app between instances has nothing. */
    get(appId: string): AppResumablesSnapshot | undefined;
    onChange(appId: string, cb: () => void): () => void;
}

const index = <R extends { key: string }>(rows: R[] = []) => new Map(rows.map(r => [r.key, r]));

export function appResumablesTopic(source: AppResumablesSource): TopicProvider<'appResumables'> {
    return diffTopic({
        read: ({ id }) => source.get(id),
        onChange: ({ id }, cb) => source.onChange(id, cb),
        diff: (prev, next) => {
            const r = diffKeyedRows(index(prev?.resumables), next?.resumables ?? []);
            const s = diffKeyedRows(index(prev?.scripts), next?.scripts ?? []);
            if (!r && !s) return undefined;
            const delta: AppResumablesDelta = {};
            if (r) delta.resumables = r;
            if (s) delta.scripts = s;
            return delta;
        },
    });
}
