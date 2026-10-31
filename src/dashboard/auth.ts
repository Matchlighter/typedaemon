import { timingSafeEqual } from "crypto";
import type { IncomingMessage } from "http";

/** Home Assistant supervisor's ingress proxy address */
const INGRESS_ADDRESS = '172.30.32.2';

export interface DashboardAuthOptions {
    /** Opt-in shared secret that grants direct (non-ingress) access */
    token?: string;
}

export interface AuthorizeOptions {
    /** Also require any `Origin` header to match `Host` (for websocket upgrades) */
    checkOrigin?: boolean;
}

export interface DashboardAuthorizer {
    (req: IncomingMessage, opts?: AuthorizeOptions): boolean;
    /** `Set-Cookie` value to persist access, if the request authorized via `?token=` (so follow-up asset/ws requests carry it) */
    sessionCookie(req: IncomingMessage): string | undefined;
}

const COOKIE_NAME = 'td_dashboard_token';

const safeEqual = (a: string, b: string) => {
    const ab = Buffer.from(a), bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const queryToken = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? undefined;

function cookieToken(req: IncomingMessage) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const [name, ...value] = part.trim().split('=');
        if (name === COOKIE_NAME) {
            try { return decodeURIComponent(value.join('=')) } catch { return undefined }
        }
    }
}

function presentedTokens(req: IncomingMessage) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return [m?.[1], queryToken(req), cookieToken(req)];
}

function originMatchesHost(req: IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

/** Builds the dashboard access check: ingress proxy always allowed; anything else needs the configured token (Bearer header, `?token=` or session cookie). */
export function dashboardAuthorizer({ token }: DashboardAuthOptions): DashboardAuthorizer {
    const matches = (presented?: string) => !!token && presented !== undefined && safeEqual(presented, token);
    const authorize = (req: IncomingMessage, { checkOrigin }: AuthorizeOptions = {}) => {
        const addr = req.socket.remoteAddress?.replace(/^::ffff:/, '');
        if (addr === INGRESS_ADDRESS) return true;
        if (checkOrigin && !originMatchesHost(req)) return false;
        return presentedTokens(req).some(matches);
    };
    const sessionCookie = (req: IncomingMessage) =>
        matches(queryToken(req)) ? `${COOKIE_NAME}=${encodeURIComponent(token!)}; Path=/; HttpOnly; SameSite=Strict` : undefined;
    return Object.assign(authorize, { sessionCookie });
}
