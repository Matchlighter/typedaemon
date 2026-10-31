import type { AppRow, OrphanRow } from "./protocol";
import type { TopicProvider } from "./topics";

export type AppsChange =
    | { type: 'app'; row: AppRow }
    | { type: 'removed'; id: string }
    | { type: 'orphans' };

/**
 * Data-source seam of the `apps` topic: the topic owns the wire shape, the source owns where data comes from
 * (see `hypervisorAppsSource`). Keeps the topic testable without a hypervisor.
 */
export interface AppsSource {
    list(): AppRow[];
    orphans(): Promise<OrphanRow[]>;
    onChange(cb: (change: AppsChange) => void): () => void;
}

export function appsTopic(source: AppsSource): TopicProvider<'apps'> {
    return {
        snapshot: async () => ({ apps: source.list(), orphans: await source.orphans() }),
        subscribe: (_params, emit) => source.onChange(change => {
            switch (change.type) {
                case 'app': return emit({ upsert: [change.row] });
                case 'removed': return emit({ remove: [change.id] });
                case 'orphans': return void source.orphans().then(orphans => emit({ orphans }), () => { });
            }
        }),
    };
}
