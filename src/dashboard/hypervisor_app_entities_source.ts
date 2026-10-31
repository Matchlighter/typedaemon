import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { PersistentStorage } from "../hypervisor/persistent_storage";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { followAppInstance } from "./follow_app";
import type { AppEntitiesSource } from "./app_entities_topic";
import type { EntityDetail, EntityRow } from "./protocol";

export type EntityStateInfo = Pick<EntityDetail, 'attributes' | 'lastChanged' | 'lastUpdated'>;

/**
 * What a plugin must offer to have its entities shown (implemented by `HomeAssistantPlugin`).
 * Keys are `<plugin id>:<registry key>`; `deleteUnlinkedEntity` takes the registry key.
 */
export interface AppEntityProvider {
    appEntities(app: ApplicationInstance): EntityRow[];
    /** `cb` fires whenever `appEntities(app)` may have changed */
    observeAppEntities(app: ApplicationInstance, cb: () => void): () => void;
    deleteUnlinkedEntity(app: ApplicationInstance, cuid: string): Promise<void>;
    /** The entities remembered in the store of an app that is not running (an orphan); none of them is linked */
    storedEntities(storage: PersistentStorage): EntityRow[];
    /** HA's live state object of an entity (by entity_id), if it has one */
    entityState(entityId: string): EntityStateInfo | undefined;
    /** `cb` fires whenever `entityState(entityId)` may have changed */
    observeEntityState(entityId: string, cb: () => void): () => void;
    /** Fires when any app's tracked entities change */
    entityEvents: { on(e: 'change', cb: (app: ApplicationInstance) => void): unknown; off(e: 'change', cb: (app: ApplicationInstance) => void): unknown };
}

export type AppEntitiesHost = Pick<Hypervisor, 'currentConfig' | 'getApplication' | 'listPlugins' | 'on' | 'off'>;

const isProvider = (x: any): x is AppEntityProvider => typeof x?.appEntities === 'function';

export function entityProviders(host: Pick<Hypervisor, 'listPlugins'>): { id: string; provider: AppEntityProvider }[] {
    return host.listPlugins().filter(p => isProvider(p.instance)).map(p => ({ id: p.id, provider: p.instance as any }));
}

/** Entity counts for an app's row/tab; undefined if no plugin can tell */
export function appEntityCounts(host: Pick<Hypervisor, 'listPlugins'>, app: ApplicationInstance) {
    const providers = entityProviders(host);
    if (!providers.length) return undefined;
    const rows = providers.flatMap(p => p.provider.appEntities(app));
    const unlinked = rows.filter(r => !r.linked).length;
    return { entities: rows.length - unlinked, unlinkedEntities: unlinked };
}

export function hypervisorAppEntitiesSource(host: AppEntitiesHost): AppEntitiesSource & { remove(appId: string, key: string): Promise<void> } {
    return {
        list(appId) {
            const app = host.getApplication(appId);
            if (!app) return host.currentConfig.apps?.[appId] ? [] : undefined;
            return entityProviders(host).flatMap(p => p.provider.appEntities(app));
        },

        // A restart is a new instance: follow it. Entities of the new instance register as it starts.
        onChange: (appId, cb) => followAppInstance(host, appId, (app, state) => {
            const observers = app && state !== 'stopped' ? entityProviders(host).map(p => p.provider.observeAppEntities(app, cb)) : [];
            return () => observers.forEach(f => f());
        }, cb),

        async remove(appId, key) {
            const app = host.getApplication(appId);
            if (!app) throw new Error(`App is not running: ${appId}`);
            const target = entityProviders(host).find(p => key.startsWith(`${p.id}:`));
            if (!target) throw new Error(`Unknown plugin for entity: ${key}`);
            await target.provider.deleteUnlinkedEntity(app, key.slice(target.id.length + 1));
        },
    };
}

/**
 * `cb` fires when any app's tracked entities change, for any entity provider.
 * Providers are re-resolved on plugin lifecycle (a restarted plugin is a new instance whose events the old one never emits).
 */
export function observeEntityEvents(host: Pick<Hypervisor, 'listPlugins' | 'on' | 'off'>, cb: (app: ApplicationInstance) => void): () => void {
    let providers: AppEntityProvider[] = [];
    const bind = () => {
        providers.forEach(p => p.entityEvents.off('change', cb));
        providers = entityProviders(host).map(p => p.provider);
        providers.forEach(p => p.entityEvents.on('change', cb));
    };
    host.on('plugin_lifecycle', bind);
    bind();
    return () => {
        host.off('plugin_lifecycle', bind);
        providers.forEach(p => p.entityEvents.off('change', cb));
        providers = [];
    };
}
