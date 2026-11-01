import * as Sentry from "@sentry/node";
import { inspect } from "util";

import { mapStackTrace } from "../app_transformer/source_maps";
import { current } from "./safe_current";

// The hypervisor installs its own process-level handlers (which route by app/system); Sentry's would double-report
const OWN_HANDLER_INTEGRATIONS = new Set(["OnUncaughtException", "OnUnhandledRejection"]);

/**
 * Where system errors (TypeDaemon itself, plugins) go when `sentry.system_dsn` is not configured.
 * TODO: set to the project's DSN before release.
 */
export const DEFAULT_SYSTEM_DSN: string | undefined = undefined;

/**
 * `undefined` = not configured: use the default (else the `SENTRY_DSN` environment variable).
 * `null` or `''` = explicit opt-out: nothing is reported, whatever the environment says.
 */
export function resolveSystemDsn(configured: string | null | undefined, fallback = DEFAULT_SYSTEM_DSN): { dsn?: string; enabled: boolean } {
    if (configured === undefined) return { dsn: fallback, enabled: true };
    if (!configured) return { enabled: false };
    return { dsn: configured, enabled: true };
}

function initSystemClient(dsn?: string, enabled = true) {
    Sentry.init({
        dsn,
        enabled,
        integrations: (defaults) => defaults.filter((i) => !OWN_HANDLER_INTEGRATIONS.has(i.name)),
    });
}

// Before the config is read only an explicit `SENTRY_DSN` applies (the default is applied by `configureSentry`, which honors opt-out)
initSystemClient();

/** Where an error is reported: `system` = TypeDaemon itself & plugins, `app` = user applications */
export type SentryTarget = 'app' | 'system';

export interface SentryConfig {
    /** DSN for errors from user applications. App errors are dropped when unset (they never go to `system_dsn`). */
    dsn?: string;
    /** DSN for system errors (TypeDaemon itself, plugins). Unset: TypeDaemon's default; `null` or `''`: don't report system errors. */
    system_dsn?: string | null;
}

let appClient: Sentry.NodeClient | undefined;

export function configureSentry(cfg?: SentryConfig) {
    void appClient?.close();
    appClient = undefined;

    const system = resolveSystemDsn(cfg?.system_dsn);
    initSystemClient(system.dsn, system.enabled);

    if (cfg?.dsn) {
        // Standalone client (no global handlers/instrumentation): only ever used via captureExceptionWithSourceMaps
        appClient = new Sentry.NodeClient({
            dsn: cfg.dsn,
            integrations: [],
            transport: Sentry.makeNodeTransport,
            stackParser: Sentry.defaultStackParser,
        });
        appClient.init();
    }
}

/** Sentry only renders a useless "Object captured as exception with keys: ..." for non-Errors; give them a message */
export function normalizeException(exception: unknown): Error {
    if (exception instanceof Error) return exception;
    const o = exception as any;
    const detail = o && typeof o === 'object' ? (o.message ?? o.error?.message) : undefined;
    const err = new Error(typeof detail === 'string' ? detail : `Non-Error thrown: ${inspect(exception, { depth: 2 })}`);
    err.name = 'NonErrorException';
    (err as any).original = exception;
    return err;
}

/**
 * @param target Defaults to `app` inside an application's context, else `system`
 */
export function captureExceptionWithSourceMaps(exception: any, context?: Parameters<typeof Sentry.captureException>[1], target?: SentryTarget) {
    exception = normalizeException(exception);
    target ??= current.application ? 'app' : 'system';

    const enhancedContext: any = {
        ...context,
    };

    enhancedContext.tags ??= {};
    enhancedContext.tags.application ??= current.application?.id;
    enhancedContext.tags.plugin ??= current.plugin?.id;

    // Apply source maps to the error stack trace
    if (exception instanceof Error && exception.stack) {
        const mappedStack = mapStackTrace(exception);
        // Create a new error with the mapped stack trace
        const mappedError = new Error(exception.message);
        mappedError.name = exception.name;
        mappedError.stack = [exception.name + ': ' + exception.message, ...mappedStack.slice(0)].join('\n');
        // Copy any additional properties
        Object.setPrototypeOf(mappedError, Object.getPrototypeOf(exception));
        for (const key in exception) {
            if (key !== 'message' && key !== 'name' && key !== 'stack') {
                (mappedError as any)[key] = (exception as any)[key];
            }
        }
        exception = mappedError;
    }

    if (target === 'app') {
        // Third-party app errors are only ever reported to the user's own DSN
        if (!appClient) return undefined;
        const scope = new Sentry.Scope();
        scope.setClient(appClient);
        scope.update(enhancedContext);
        return appClient.captureException(exception, {}, scope);
    }
    return Sentry.captureException(exception, enhancedContext);
}

export * from "@sentry/node";
