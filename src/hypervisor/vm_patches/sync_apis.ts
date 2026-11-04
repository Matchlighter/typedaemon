import * as path from "path";

import { current } from "../current";
import { registerPatch } from "./base";

/**
 * Apps share one event loop with the hypervisor, so a blocking call in one app stalls every app.
 * Replace the common synchronous host APIs with versions that throw when called from app code.
 *
 * Opt out per-app with `allow_sync: true` in the app's config.
 *
 * Guardrail, not a sandbox: it only covers modules obtained via `require`/`import` and only the listed functions.
 * Calls whose nearest caller is in `node_modules` or TypeDaemon itself are allowed (deps routinely read files at load).
 */

const SYNC_APIS: { match: RegExp, fns: RegExp | string[] }[] = [
    { match: /^(node:)?fs$/, fns: /Sync$/ },
    { match: /^(node:)?child_process$/, fns: ['execSync', 'execFileSync', 'spawnSync'] },
    { match: /^(node:)?zlib$/, fns: /Sync$/ },
    { match: /^(node:)?crypto$/, fns: ['pbkdf2Sync', 'scryptSync', 'generateKeyPairSync', 'generatePrimeSync', 'randomFillSync'] },
];

// `src/` (or `dist/`) of this package
const OWN_ROOT = path.resolve(__dirname, "..", "..") + path.sep;

function isAppCodeFrame(file: string) {
    if (file.startsWith("node:") || file.startsWith("internal/")) return false;
    if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes("/node_modules/")) return false;
    if (file.startsWith(OWN_ROOT)) return false;
    return true;
}

/** True if the nearest non-builtin caller of the wrapper is app code */
export function calledFromAppCode(stack = new Error().stack) {
    const lines = (stack || "").split("\n").slice(1);
    for (const line of lines) {
        const m = line.match(/\(?((?:file:\/\/)?[^\s()]+?):\d+:\d+\)?\s*$/);
        const file = m?.[1];
        if (!file) continue;
        if (file.startsWith("node:") || file.startsWith("internal/")) continue;
        if (file.startsWith(OWN_ROOT) && file.includes("vm_patches")) continue; // the wrapper itself
        return isAppCodeFrame(file);
    }
    return false;
}

/** @internal test seam */
export const _internals = { calledFromAppCode };

function syncAllowed() {
    return !!current.application?.app_config?.allow_sync;
}

for (const { match, fns } of SYNC_APIS) {
    registerPatch(match, (mod) => {
        const names = Array.isArray(fns) ? fns : Object.keys(mod).filter(k => fns.test(k));
        for (const name of names) {
            const original = mod[name];
            if (typeof original !== 'function') continue;

            const wrapped = function (this: any, ...args: any[]) {
                if (current.application && !syncAllowed() && _internals.calledFromAppCode()) {
                    throw new Error(
                        `Synchronous API '${name}' blocks the event loop shared by all apps and is disabled in TypeDaemon apps. ` +
                        `Use the async version, or set 'allow_sync: true' in this app's config to opt out.`
                    );
                }
                return original.apply(this, args);
            };
            Object.defineProperty(wrapped, 'name', { value: name });
            mod[name] = wrapped;
        }
    });
}
