type Path = string[];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Where `resolved` (a config after defaults/normalization) has values the config file did not give, as the highest such
 * paths (a subtree missing from the file is one path). Arrays are values: never descended into.
 */
export function defaultPaths(resolved: unknown, raw: unknown, prefix: Path = []): Path[] {
    if (!isObject(resolved)) return [];
    const out: Path[] = [];
    for (const [k, v] of Object.entries(resolved)) {
        if (!isObject(raw) || !Object.prototype.hasOwnProperty.call(raw, k)) out.push([...prefix, k]);
        else if (isObject(v) && isObject(raw[k])) out.push(...defaultPaths(v, raw[k], [...prefix, k]));
    }
    return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Best-effort 1-based line of an app's key under `apps` in the config file text (YAML, JSON5 or JS/TS object literal).
 * Config files are evaluated, not parsed to a syntax tree, so positions aren't known; a textual search is as close as it gets.
 */
export function configLine(text: string, appId: string): number | undefined {
    const lines = text.split('\n');
    const appsAt = lines.findIndex(l => /^\s*["']?apps["']?\s*:/.test(l));
    if (appsAt < 0) return undefined;
    const key = new RegExp(`^\\s*["']?${esc(appId)}["']?\\s*:`);
    const at = lines.findIndex((l, i) => i > appsAt && key.test(l));
    return at < 0 ? undefined : at + 1;
}
