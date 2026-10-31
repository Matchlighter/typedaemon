import { dashboardAuthorizer } from './auth';

const req = (o: { ip?: string; headers?: Record<string, string>; url?: string } = {}): any =>
    ({ socket: { remoteAddress: o.ip ?? '10.0.0.5' }, headers: o.headers ?? {}, url: o.url ?? '/' });

describe('dashboardAuthorizer', () => {
    it('accepts the supervisor ingress proxy', () => {
        const auth = dashboardAuthorizer({});
        expect(auth(req({ ip: '172.30.32.2' }))).toBe(true);
        expect(auth(req({ ip: '::ffff:172.30.32.2' }))).toBe(true);
    });

    it('rejects everything else when no token is configured', () => {
        const auth = dashboardAuthorizer({});
        expect(auth(req())).toBe(false);
        expect(auth(req({ headers: { authorization: 'Bearer x' } }))).toBe(false);
    });

    it('accepts a configured token via Bearer header or ?token=, rejects wrong/missing', () => {
        const auth = dashboardAuthorizer({ token: 'sekret' });
        expect(auth(req({ headers: { authorization: 'Bearer sekret' } }))).toBe(true);
        expect(auth(req({ url: '/ws?token=sekret' }))).toBe(true);
        expect(auth(req({ headers: { authorization: 'Bearer nope' } }))).toBe(false);
        expect(auth(req({ url: '/ws?token=sekre' }))).toBe(false);
        expect(auth(req())).toBe(false);
    });

    it('allows a mismatched Origin from ingress only; direct requests need a matching or absent Origin', () => {
        const auth = dashboardAuthorizer({ token: 't' });
        const h = (origin?: string) => ({ authorization: 'Bearer t', host: 'td.local:8099', ...(origin ? { origin } : {}) });
        expect(auth(req({ headers: h('http://evil.example') }), { checkOrigin: true })).toBe(false);
        expect(auth(req({ ip: '172.30.32.2', headers: { host: 'a', origin: 'http://b' } }), { checkOrigin: true })).toBe(true);
        expect(auth(req({ headers: h('http://td.local:8099') }), { checkOrigin: true })).toBe(true);
        expect(auth(req({ headers: h() }), { checkOrigin: true })).toBe(true);
        expect(auth(req({ headers: h('http://evil.example') }))).toBe(true);
    });

    it('offers a session cookie only for a valid ?token=, and accepts that cookie alone', () => {
        const auth = dashboardAuthorizer({ token: 'a b;c' });
        const cookie = auth.sessionCookie(req({ url: '/?token=' + encodeURIComponent('a b;c') }))!;
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);
        expect(cookie).toMatch(/Path=\//);
        expect(auth.sessionCookie(req({ url: '/?token=wrong' }))).toBeUndefined();
        expect(auth.sessionCookie(req({ headers: { authorization: 'Bearer a b;c' } }))).toBeUndefined();
        const sent = { cookie: 'other=1; ' + cookie.split(';')[0] };
        expect(auth(req({ headers: sent }))).toBe(true);
        expect(auth(req({ headers: { cookie: 'td_dashboard_token=wrong' } }))).toBe(false);
    });
});
