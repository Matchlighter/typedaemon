import { listOrphanIds } from "../hypervisor/orphan_apps";
import { combinedEntitiesSource } from "./combined_entities_source";
import type { EntitiesSource } from "./entities_topic";
import { hypervisorAppEntitiesSource, type AppEntitiesHost } from "./hypervisor_app_entities_source";
import { orphanEntities, type OrphanSourceHost } from "./hypervisor_orphan_source";

/** What the global entities list needs from the hypervisor (public API only) */
export type EntitiesHost = AppEntitiesHost & Pick<OrphanSourceHost, 'working_directory' | 'operations_directory' | 'defaultAppPersistenceFile' | 'listApplications' | 'watchConfigEntry'>;

/** Entities of every configured app (as on its own Entities tab) and of every orphan, live. */
export function hypervisorEntitiesSource(host: EntitiesHost, apps = hypervisorAppEntitiesSource(host)): EntitiesSource {
    return combinedEntitiesSource({
        appIds: () => Object.keys(host.currentConfig.apps ?? {}),
        onAppsChanged: cb => host.watchConfigEntry('apps', cb),
        apps,
        orphans: {
            ids: () => listOrphanIds(host),
            entities: id => orphanEntities(host, id),
            onChange(cb) {
                host.on('orphans_changed', cb);
                const offConfig = host.watchConfigEntry('apps', cb);
                return () => { host.off('orphans_changed', cb); offConfig() };
            },
        },
    });
}
