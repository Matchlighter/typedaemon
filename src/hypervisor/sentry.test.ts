import * as Sentry from "@sentry/node";

jest.mock("@sentry/node", () => ({ ...jest.requireActual("@sentry/node"), captureException: jest.fn(() => "sys") }));

import { isHaConnectionLost } from "../plugins/home_assistant/errors";
import { captureExceptionWithSourceMaps, configureSentry, normalizeException, resolveSystemDsn } from "./sentry";

const lost = { type: 'result', success: false, error: { code: 3, message: 'Connection lost' } };

describe("normalizeException", () => {
    it("keeps Errors", () => {
        const e = new Error("x");
        expect(normalizeException(e)).toBe(e);
    });

    it("gives plain objects a message and keeps the original", () => {
        const e = normalizeException(lost);
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toBe("Connection lost");
        expect((e as any).original).toBe(lost);
    });

    it("describes arbitrary values", () => {
        expect(normalizeException("boom").message).toContain("boom");
        expect(normalizeException(undefined).message).toContain("undefined");
    });
});

describe("isHaConnectionLost", () => {
    it("matches the library's in-flight rejection only", () => {
        expect(isHaConnectionLost(lost)).toBe(true);
        expect(isHaConnectionLost(3)).toBe(true);
        expect(isHaConnectionLost({ type: 'result', error: { code: 1 } })).toBe(false);
        expect(isHaConnectionLost(new Error("x"))).toBe(false);
        expect(isHaConnectionLost(undefined)).toBe(false);
    });
});

describe("resolveSystemDsn", () => {
    it("uses the default when not configured", () => {
        expect(resolveSystemDsn(undefined, "default")).toEqual({ dsn: "default", enabled: true });
    });

    it("opts out on null or ''", () => {
        expect(resolveSystemDsn(null, "default")).toEqual({ enabled: false });
        expect(resolveSystemDsn("", "default")).toEqual({ enabled: false });
    });

    it("prefers a configured DSN", () => {
        expect(resolveSystemDsn("mine", "default")).toEqual({ dsn: "mine", enabled: true });
    });
});

describe("captureExceptionWithSourceMaps routing", () => {
    afterEach(() => { configureSentry(); jest.clearAllMocks() });

    const spies = () => ({
        system: Sentry.captureException as jest.Mock,
        app: jest.spyOn(Sentry.NodeClient.prototype, "captureException").mockReturnValue("app"),
    });

    it("sends app errors to dsn and system errors to the system client", () => {
        const { system, app } = spies();
        configureSentry({ dsn: "https://k@o0.ingest.sentry.io/1", system_dsn: "https://k@o0.ingest.sentry.io/2" });

        expect(captureExceptionWithSourceMaps(new Error("a"), undefined, 'app')).toBe("app");
        expect(captureExceptionWithSourceMaps(new Error("s"), undefined, 'system')).toBe("sys");
        expect(app).toHaveBeenCalledTimes(1);
        expect(system).toHaveBeenCalledTimes(1);
        app.mockRestore();
    });

    it("drops app errors when dsn is unset; never falls back to the system client", () => {
        const { system, app } = spies();
        configureSentry({ system_dsn: "https://k@o0.ingest.sentry.io/2" });

        expect(captureExceptionWithSourceMaps(new Error("a"), undefined, 'app')).toBeUndefined();
        expect(system).not.toHaveBeenCalled();
        expect(app).not.toHaveBeenCalled();
        app.mockRestore();
    });
});
