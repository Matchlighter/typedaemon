import * as Sentry from "@sentry/node";

import { mapStackTrace } from "../app_transformer/source_maps";
import { current } from "./safe_current";

Sentry.init();

export function captureExceptionWithSourceMaps(exception: any, context?: Parameters<typeof Sentry.captureException>[1]) {
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

    // If not an Error with stack, just pass through
    return Sentry.captureException(exception, enhancedContext);
}

export * from "@sentry/node";
