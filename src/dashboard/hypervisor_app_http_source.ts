import * as path from "path";
import type { Hypervisor } from "../hypervisor/hypervisor";
import type { HttpRouteInfo, HttpRouteRegistry } from "../plugins/http/routes";
import type { AppHttpSource } from "./app_http_topic";
import { followAppInstance, type FollowAppHost } from "./follow_app";
import type { HttpRouteRow } from "./protocol";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppHttpHost = FollowAppHost & Pick<Hypervisor, 'working_directory' | 'currentConfig' | 'listPlugins'>;

/** What a plugin must offer to have its routes shown (implemented by `HttpPlugin`) */
export interface AppHttpProvider {
    readonly routes: HttpRouteRegistry;
    readonly port: number;
}

const isProvider = (x: any): x is AppHttpProvider => typeof x?.routes?.list === 'function';

const httpProvider = (host: Pick<Hypervisor, 'listPlugins'>): AppHttpProvider | undefined => host.listPlugins().map(p => p.instance as unknown).find(isProvider);

/** The `<uuid>` in `/app/<uuid>/...`: known from the config, so also before the app has an instance */
const appUuid = (host: Pick<Hypervisor, 'currentConfig'>, appId: string) => host.currentConfig.apps?.[appId]?.uuid || appId;

/** Tab count: routes and static mounts; undefined if there is no HTTP plugin to ask */
export function appHttpCounts(host: Pick<Hypervisor, 'listPlugins' | 'currentConfig'>, appId: string) {
    const provider = httpProvider(host);
    return provider && { http: provider.routes.list(appUuid(host, appId)).length };
}

/** `cb` fires when the app's routes may have changed (including its restarts, which unregister and re-register them) */
export function observeAppHttp(host: FollowAppHost & Pick<Hypervisor, 'listPlugins' | 'currentConfig'>, appId: string, cb: () => void): () => void {
    const provider = httpProvider(host);
    if (!provider) return () => { };
    return followAppInstance(host, appId, () => {
        const uuid = appUuid(host, appId);
        const onChange = (changed: string) => { if (changed === uuid) cb() };
        provider.routes.on('change', onChange);
        return () => { provider.routes.off('change', onChange) };
    }, cb);
}

function toRow(host: Pick<Hypervisor, 'working_directory'>, r: HttpRouteInfo): HttpRouteRow {
    const url = `/app/${encodeURIComponent(r.appUuid)}${r.path}`;
    if (r.kind === 'static') {
        return { key: String(r.id), kind: 'static', path: r.path, handler: path.relative(host.working_directory, r.directory!), url };
    }
    return { key: String(r.id), kind: 'route', method: r.method, path: r.path, handler: r.handler!, url };
}

export function hypervisorAppHttpSource(host: AppHttpHost): AppHttpSource {
    return {
        get port() { return httpProvider(host)?.port },
        list(appId) {
            if (!host.currentConfig.apps?.[appId]) return undefined;
            return httpProvider(host)?.routes.list(appUuid(host, appId)).map(r => toRow(host, r)) ?? [];
        },
        onChange: (appId, cb) => observeAppHttp(host, appId, cb),
    };
}
