import type { EntitiesSource } from "./entities_topic";
import type { EntitySource } from "./entity_topic";
import { entityProviders, type AppEntitiesHost } from "./hypervisor_app_entities_source";

export type EntityHost = Pick<AppEntitiesHost, 'listPlugins' | 'on' | 'off'>;

/**
 * One entity of the global list (`entities`) plus HA's live state for it.
 * Row changes come from the list; state changes (attributes) from the plugin, re-bound when the entity_id becomes known
 * or changes, and when a plugin restarts (a restarted plugin is a new instance with a new state store).
 */
export function hypervisorEntitySource(host: EntityHost, entities: EntitiesSource): EntitySource {
    const find = async (id: string) => (await entities.list()).find(r => r.key === id);

    return {
        async get(id) {
            const row = await find(id);
            if (!row) return undefined;
            const state = row.entityId === undefined ? undefined : entityProviders(host)
                .filter(p => p.id === row.plugin)
                .map(p => p.provider.entityState(row.entityId!))
                .find(Boolean);
            return { ...row, ...state };
        },

        onChange(id, cb) {
            let disposed = false;
            let bound: { entityId: string; off: () => void } | undefined;
            const unbind = () => { bound?.off(); bound = undefined };
            // Async: the entity_id comes from the (async) list. Newer calls supersede older ones in flight.
            let seq = 0;
            const bind = async (force: boolean) => {
                const mine = ++seq;
                const row = await find(id).catch(() => undefined);
                const entityId = row?.entityId;
                if (disposed || mine !== seq || (!force && bound?.entityId === entityId)) return;
                unbind();
                if (entityId === undefined) return;
                const offs = entityProviders(host).filter(p => p.id === row!.plugin).map(p => p.provider.observeEntityState(entityId, cb));
                bound = { entityId, off: () => offs.forEach(f => f()) };
            };
            const onPlugin = () => { bind(true); cb() };
            host.on('plugin_lifecycle', onPlugin);
            const offRows = entities.onChange(() => { bind(false); cb() });
            bind(true);
            return () => {
                disposed = true;
                unbind();
                offRows();
                host.off('plugin_lifecycle', onPlugin);
            };
        },
    };
}
