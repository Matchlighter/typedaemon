import { RouteStore } from './stores/route_store';

/** Route paths (no `#`), for `RouteStore.navigate` */
export const appPath = (id: string, tab?: string) => `/apps/${encodeURIComponent(id)}${tab && tab !== 'overview' ? `/${tab}` : ''}`;
/** `id`: `GlobalEntityRow.key` */
export const entityPath = (id: string) => `/entities/${encodeURIComponent(id)}`;
export const pluginPath = (id: string) => `/plugins/${encodeURIComponent(id)}`;

/** Links: `tab` is an app detail tab key (`overview` and none: the bare app page); for an orphan id: `leftovers` / `cleanup` open its modal / clean-up confirmation */
export const appHref = (id: string, tab?: string, query?: Record<string, string>) => RouteStore.href(appPath(id, tab), query);
export const entityHref = (id: string) => RouteStore.href(entityPath(id));
export const pluginHref = (id: string) => RouteStore.href(pluginPath(id));

/**
 * HA's entity settings filtered to one entity, or undefined when the dashboard can't tell where HA is.
 * Under HA Ingress the dashboard is on HA's own origin (inside its iframe): a root-relative link, opened in the top frame.
 * Otherwise it needs the base URL the server learned from HA (`haBaseUrl`, `system` topic).
 */
export function haEntityHref(entityId: string, haBaseUrl: string | undefined, pathname = location.pathname): { href: string; target: '_top' | '_blank' } | undefined {
    const path = `/config/entities?search=${encodeURIComponent(entityId)}`;
    if (pathname.startsWith('/api/hassio_ingress/')) return { href: path, target: '_top' };
    return haBaseUrl ? { href: `${haBaseUrl.replace(/\/+$/, '')}${path}`, target: '_blank' } : undefined;
}
/** The app's Logs tab, opened on the given line (the one that reported a failure) or, without one, on the newest error */
export const errorLogsHref = (appId: string, logId?: number) => appHref(appId, 'logs', { focus: logId === undefined ? 'error' : String(logId) });
