import * as fs from "fs";
import * as path from "path";
import { listOrphanIds, orphanRemovedAt } from "../hypervisor/orphan_apps";
import type { Hypervisor } from "../hypervisor/hypervisor";
import { PersistentStorage } from "../hypervisor/persistent_storage";
import type { OrphanSource } from "./orphan_topic";
import { entityProviders } from "./hypervisor_app_entities_source";
import { storageRows } from "./hypervisor_app_storage_source";
import type { EntityRow, OrphanDestroyerRow, OrphanLeftovers, OrphanSnapshot, OrphanSummary } from "./protocol";
import { onAppLifecycle } from "./follow_app";

/** What the dashboard needs from the hypervisor (public API only) */
export type OrphanSourceHost = Pick<Hypervisor, 'working_directory' | 'operations_directory' | 'defaultAppOperatingDirectory' | 'defaultAppPersistenceFile' | 'currentConfig' | 'listApplications' | 'listPlugins' | 'destroyApplication' | 'watchConfigEntry' | 'on' | 'off'>;

/** Bytes and files below `dir`. Symlinks count as themselves: they are neither followed nor (on cleanup) followed when deleting */
async function measure(dir: string): Promise<{ bytes: number; files: number }> {
    let bytes = 0, files = 0;
    const walk = async (d: string) => {
        for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                await walk(p);
            } else {
                files++;
                bytes += (await fs.promises.lstat(p).catch(() => undefined))?.size ?? 0;
            }
        }
    };
    await walk(dir);
    return { bytes, files };
}

/** The persisted store of orphan `id`, read-only: nothing is written, the temporary store is just dropped */
async function loadOrphanStore(host: Pick<OrphanSourceHost, 'defaultAppPersistenceFile'>, id: string) {
    const file = host.defaultAppPersistenceFile(id);
    const store = new PersistentStorage(file);
    await store.load();
    return { store, file };
}

/** Entities an orphan left in Home Assistant, as far as its autoclean registry knows. None of them is linked. */
export async function orphanEntities(host: Pick<OrphanSourceHost, 'defaultAppPersistenceFile' | 'listPlugins'>, id: string): Promise<EntityRow[]> {
    const { store } = await loadOrphanStore(host, id);
    return entityProviders(host).flatMap(p => p.provider.storedEntities(store));
}

type LeftoversHost = Pick<OrphanSourceHost, 'working_directory' | 'operations_directory' | 'defaultAppOperatingDirectory' | 'defaultAppPersistenceFile' | 'listPlugins'>;

/** Everything orphan `id` left behind. Rejects if the directory is gone (cleaned up meanwhile) */
export async function orphanLeftovers(host: LeftoversHost, id: string): Promise<OrphanLeftovers> {
    const dir = host.defaultAppOperatingDirectory(id);
    const { store, file } = await loadOrphanStore(host, id);
    const destroyers = Object.values((store.getValue("_destroyers") ?? {}) as Record<string, OrphanDestroyerRow>)
        .map(({ uuid, type, options }) => ({ uuid, type, options }));
    return {
        dir: { path: path.relative(host.working_directory, dir), ...await measure(dir) },
        storage: storageRows(store, file),
        entities: entityProviders(host).flatMap(p => p.provider.storedEntities(store)),
        destroyers,
    };
}

/** List-row digest of `orphanLeftovers`; undefined if they cannot be read */
export async function orphanSummary(host: LeftoversHost, id: string): Promise<OrphanSummary | undefined> {
    try {
        const [l, removedAt] = await Promise.all([orphanLeftovers(host, id), orphanRemovedAt(host, id)]);
        if (removedAt === undefined) return undefined;
        return { removedAt, entities: l.entities.length, storageKeys: l.storage.filter(r => !r.internal).length, dirBytes: l.dir.bytes, destroyers: l.destroyers.map(d => d.type) };
    } catch { return undefined }
}

export function hypervisorOrphanSource(host: OrphanSourceHost): OrphanSource {
    const leftovers = (id: string) => orphanLeftovers(host, id);

    return {
        async get(id): Promise<OrphanSnapshot> {
            let isOrphan = false;
            try { isOrphan = (await listOrphanIds(host)).includes(id) } catch { }
            if (!isOrphan) return { id };
            // Cleaned up between the check and the read: the dir is gone, so is the orphan
            return leftovers(id).then(l => ({ id, leftovers: l }), () => ({ id }));
        },

        cleanup: id => host.destroyApplication(id),

        onChange(id, cb) {
            const offLifecycle = onAppLifecycle(host, id, cb);
            host.on('orphans_changed', cb);
            const offConfig = host.watchConfigEntry('apps', cb);
            return () => {
                offLifecycle();
                host.off('orphans_changed', cb);
                offConfig();
            };
        },
    };
}
