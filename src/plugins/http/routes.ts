import { ObservableRegistry } from "../../common/observable_registry";

export interface HttpRouteDefinition {
    /** `ApplicationInstance.uuid`: the `<uuid>` in `/app/<uuid>/...` */
    appUuid: string;
    kind: 'route' | 'static';
    /** Upper case; `ALL` for any */
    method?: string;
    /** As the app wrote it, relative to the app's URL root */
    path: string;
    /** Name of the handler function (routes) */
    handler?: string;
    /** Absolute directory served (static mounts) */
    directory?: string;
}

export interface HttpRouteInfo extends HttpRouteDefinition {
    id: number;
}

/**
 * The routes and static mounts apps registered on the HTTP plugin. Express keeps these only inside its
 * router internals, so this is the one place that can tell what an app serves.
 * `change` carries the uuid of the app whose routes changed.
 */
export class HttpRouteRegistry extends ObservableRegistry<HttpRouteInfo, [appUuid: string]> {
    /** Returns the unregistration */
    add(def: HttpRouteDefinition): () => void {
        return this.register(def, def.appUuid).remove;
    }

    list(appUuid?: string): HttpRouteInfo[] {
        const all = super.list();
        return appUuid === undefined ? all : all.filter(r => r.appUuid === appUuid);
    }
}
