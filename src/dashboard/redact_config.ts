const SECRET_KEY = /token|passw(or)?d|passwd|secret|api_?key|_key$|credential/i;

/** Copy of a config with the values of secret-looking keys hidden (the config is shown to anyone with dashboard access) */
export function redactConfig(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactConfig);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '***' : redactConfig(v)]));
    }
    return value;
}
