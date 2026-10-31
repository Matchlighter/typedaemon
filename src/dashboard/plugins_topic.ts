import type { PluginRow } from "./protocol";
import { keyedRowsTopic, type TopicProvider } from "./topics";

/** Data-source seam of the `plugins` topic: says "something may have changed"; the topic works out the delta. */
export interface PluginsSource {
    list(): PluginRow[];
    onChange(cb: () => void): () => void;
}

export function pluginsTopic(source: PluginsSource): TopicProvider<'plugins'> {
    return keyedRowsTopic({
        read: () => ({ plugins: source.list() }),
        onChange: (_params, cb) => source.onChange(cb),
        rowsOf: s => s.plugins,
        keyOf: (r: PluginRow) => r.id,
    });
}
