import * as fs from "fs";
import * as path from "path";
import { appDirectory, environmentsDirectory } from "./app_paths";
import type { Hypervisor } from "./hypervisor";

/** What orphan handling needs from the hypervisor */
export type OrphanHost = Pick<Hypervisor, 'operations_directory' | 'currentConfig' | 'listApplications' | 'withApplicationExclusive'>;

const isConfigured = (host: Pick<OrphanHost, 'currentConfig'>, id: string) => !!host.currentConfig.apps && id in host.currentConfig.apps;
const isLive = (host: Pick<OrphanHost, 'listApplications'>, id: string) => host.listApplications().some(a => a.id === id);

/** Throws unless app `id` is out of the config (and not live): the precondition of every cleanup */
export function assertOrphan(host: Pick<OrphanHost, 'currentConfig' | 'listApplications'>, id: string) {
    if (isConfigured(host, id) || isLive(host, id)) throw new Error(`'${id}' is not an orphan: it is in the config`);
}

/**
 * Apps that left the config but still have an operating directory.
 * (Apps with a custom `operating_directory` cannot be found once their config is gone.)
 */
export async function listOrphanIds(host: Pick<OrphanHost, 'operations_directory' | 'currentConfig' | 'listApplications'>): Promise<string[]> {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(environmentsDirectory(host.operations_directory), { withFileTypes: true }) } catch { return [] }
    return entries.filter(e => e.isDirectory() && !isConfigured(host, e.name) && !isLive(host, e.name)).map(e => e.name);
}

/**
 * Delete an orphan app's leftovers: run `destroyers` (which release what the app created elsewhere, eg entities in HA),
 * then delete its operating directory. The directory is only deleted if the destroyers succeeded and the app is still an
 * orphan, so a failure leaves everything in place to retry. Runs with exclusive access so the app cannot start meanwhile.
 */
export async function destroyOrphan(host: OrphanHost, id: string, destroyers: () => Promise<void>) {
    const dir = appDirectory(host.operations_directory, id);

    await host.withApplicationExclusive(id, async live => {
        assertOrphan(host, id);
        if (live) throw new Error(`'${id}' is not an orphan: it is running`);
        // lstat: a symlink standing in for the directory is not ours to delete (nor to follow)
        const stat = await fs.promises.lstat(dir).catch(() => undefined);
        if (!stat?.isDirectory()) throw new Error(`No leftovers for '${id}'`);

        await destroyers();

        // The config may have changed while the destroyers ran: its new instance is waiting for us and would find its files gone
        if (isConfigured(host, id) || isLive(host, id)) throw new Error(`'${id}' was added back to the config during cleanup; its directory was kept`);
        await fs.promises.rm(dir, { recursive: true });
    });
}

const REMOVED_MARKER = ".removed_at";

/** Note, in app `id`'s operating directory, that the app was just removed from the config (a no-op without a directory) */
export async function recordRemoval(host: Pick<OrphanHost, 'operations_directory'>, id: string, at = Date.now()) {
    const dir = appDirectory(host.operations_directory, id);
    if (!(await fs.promises.lstat(dir).catch(() => undefined))?.isDirectory()) return;
    await fs.promises.writeFile(path.join(dir, REMOVED_MARKER), String(at));
}

/**
 * When orphan `id` left the config: the recorded removal time, or - for apps removed while TypeDaemon was not watching -
 * the operating directory's last change (approximate: the app's last activity). Undefined if the directory is gone.
 */
export async function orphanRemovedAt(host: Pick<OrphanHost, 'operations_directory'>, id: string): Promise<number | undefined> {
    const dir = appDirectory(host.operations_directory, id);
    const recorded = Number(await fs.promises.readFile(path.join(dir, REMOVED_MARKER), "utf8").catch(() => ""));
    if (recorded > 0) return recorded;
    return (await fs.promises.stat(dir).catch(() => undefined))?.mtimeMs;
}
