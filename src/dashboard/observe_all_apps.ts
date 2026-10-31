import type { Hypervisor } from "../hypervisor/hypervisor";

/** What following every configured app needs from the hypervisor (public API only) */
export type AllAppsHost = Pick<Hypervisor, 'currentConfig' | 'watchConfigEntry'>;

export const configuredAppIds = (host: AllAppsHost) => Object.keys(host.currentConfig.apps ?? {});

/**
 * Fire `cb` whenever `observe(appId, cb)` does for any configured app; follows apps joining/leaving the config
 * (which fires `cb` too). The base of the "all apps" list sources.
 */
export function observeAllApps(host: AllAppsHost, observe: (appId: string, cb: () => void) => () => void, cb: () => void): () => void {
    const watched = new Map<string, () => void>();
    const sync = () => {
        const ids = new Set(configuredAppIds(host));
        for (const [id, off] of watched) if (!ids.has(id)) { off(); watched.delete(id) }
        for (const id of ids) if (!watched.has(id)) watched.set(id, observe(id, cb));
    };
    sync();
    const offApps = host.watchConfigEntry('apps', () => { sync(); cb() });
    return () => { offApps(); watched.forEach(off => off()); watched.clear() };
}
