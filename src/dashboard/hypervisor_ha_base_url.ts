import type { Hypervisor } from "../hypervisor/hypervisor";

/** Where a browser can open Home Assistant, as the first `home_assistant` plugin knows it */
export function hypervisorHaBaseUrl(host: Pick<Hypervisor, 'listPlugins'>): string | undefined {
    for (const p of host.listPlugins()) {
        const url = p.options?.type === 'home_assistant' ? (p.instance as { haBaseUrl?: string } | undefined)?.haBaseUrl : undefined;
        if (url) return url;
    }
}
