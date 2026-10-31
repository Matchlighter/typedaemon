import type { AppEntitiesSource } from "./app_entities_topic";
import type { EntitiesSource } from "./entities_topic";
import type { EntityRow, GlobalEntityRow } from "./protocol";

/** The pieces `combinedEntitiesSource` is made of; `hypervisorEntitiesSource` wires them to the hypervisor */
export interface CombinedEntitiesParts {
    /** Ids of the apps in the config */
    appIds(): string[];
    /** Fires when `appIds()` may have changed */
    onAppsChanged(cb: () => void): () => void;
    /** Per-app rows (as the app's own Entities tab has them) */
    apps: AppEntitiesSource;
    /** Apps that left the config; their entities come from leftovers on disk, which only change when the orphans do */
    orphans: {
        ids(): Promise<string[]>;
        entities(id: string): Promise<EntityRow[] | undefined>;
        onChange(cb: () => void): () => void;
    };
}

const globalRow = (app: string, r: EntityRow, orphan?: boolean): GlobalEntityRow =>
    ({ ...r, key: `${app}/${r.key}`, entityKey: r.key, app, ...(orphan && { orphan }) });

/** The entities of every app and orphan as one list, live. */
export function combinedEntitiesSource(parts: CombinedEntitiesParts): EntitiesSource {
    // Reading leftovers loads storage files: keep them while somebody is subscribed to hear about orphan changes
    let subscribers = 0;
    let orphanCache: Promise<GlobalEntityRow[]> | undefined;

    const readOrphans = async () => {
        const out: GlobalEntityRow[] = [];
        for (const id of await parts.orphans.ids()) {
            for (const r of await parts.orphans.entities(id) ?? []) out.push(globalRow(id, r, true));
        }
        return out;
    };
    const orphanRows = () => {
        if (!subscribers) return readOrphans();
        return orphanCache ??= readOrphans().catch(e => { orphanCache = undefined; throw e });
    };

    return {
        async list() {
            const rows = parts.appIds().flatMap(id => (parts.apps.list(id) ?? []).map(r => globalRow(id, r)));
            return [...rows, ...await orphanRows().catch(() => [])];
        },

        onChange(cb) {
            subscribers++;
            const watched = new Map<string, () => void>();
            const sync = () => {
                const ids = new Set(parts.appIds());
                for (const [id, off] of watched) if (!ids.has(id)) { off(); watched.delete(id) }
                for (const id of ids) if (!watched.has(id)) watched.set(id, parts.apps.onChange(id, cb));
            };
            sync();
            const offApps = parts.onAppsChanged(() => { sync(); cb() });
            const offOrphans = parts.orphans.onChange(() => { orphanCache = undefined; cb() });
            return () => {
                subscribers--;
                if (!subscribers) orphanCache = undefined;
                offApps(); offOrphans();
                watched.forEach(off => off());
                watched.clear();
            };
        },
    };
}
