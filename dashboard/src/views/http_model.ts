import type { AppHttpDelta, AppHttpSnapshot, HttpRouteRow } from '@protocol';
import { applyKeyedDelta } from './keyed_rows';

/** Fold an `appHttp` topic delta into the snapshot */
export const applyHttpDelta = (cur: AppHttpSnapshot, d: AppHttpDelta): AppHttpSnapshot => ({ ...cur, rows: applyKeyedDelta(cur.rows, d) });

/** Path as shown: a static mount serves everything under its prefix */
export const displayPath = (r: HttpRouteRow) => r.kind === 'static' ? `${r.path.replace(/\/+$/, '')}/*` : r.path;

/** URL to reach the route from this page: the page's host and the HTTP plugin's port (it is not the dashboard's origin under Ingress) */
export function fullUrl(r: HttpRouteRow, port: number | undefined, here: { protocol: string; hostname: string }) {
    const url = r.kind === 'static' ? `${r.url.replace(/\/+$/, '')}/` : r.url;
    return port === undefined ? url : `${here.protocol}//${here.hostname}:${port}${url}`;
}
