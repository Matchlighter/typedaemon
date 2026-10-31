/**
 * The URL a browser can open HA at: HA's configured external URL, else its internal one, else the URL TD itself
 * connects with - unless that is the Supervisor proxy (`http://supervisor/core`), which only add-ons can reach.
 */
export function pickHaBaseUrl(haConfig: { external_url?: string | null; internal_url?: string | null } | undefined, connectUrl: string | undefined): string | undefined {
    const direct = connectUrl && !connectUrl.includes('supervisor') ? connectUrl : undefined;
    return (haConfig?.external_url || haConfig?.internal_url || direct || undefined)?.replace(/\/+$/, '');
}
