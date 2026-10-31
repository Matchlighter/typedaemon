import type { CountsSnapshot } from "./protocol";
import { diffTopic, type TopicProvider } from "./topics";

/** One named total (e.g. entities): says "something may have changed"; the topic re-counts */
export interface CountSource {
    count(): number | Promise<number>;
    onChange(cb: () => void): () => void;
}

/**
 * Lightweight totals for always-on UI (nav badges), so it needn't subscribe to the heavy list topics.
 * Snapshot is `{ [name]: total }`; a delta is the fresh snapshot, sent only when some total changed.
 * A count whose read fails is left out.
 */
export function countsTopic(sources: Record<string, CountSource>): TopicProvider<'counts'> {
    const names = Object.keys(sources);
    return diffTopic<'counts', CountsSnapshot>({
        read: async () => {
            const out: CountsSnapshot = {};
            await Promise.all(names.map(async n => { try { out[n] = await sources[n].count() } catch { /* omitted */ } }));
            return out;
        },
        onChange: (_params, cb) => {
            const offs = names.map(n => sources[n].onChange(cb));
            return () => offs.forEach(off => off());
        },
        diff: (prev, next) => next && JSON.stringify(prev) !== JSON.stringify(next) ? next : undefined,
    });
}
