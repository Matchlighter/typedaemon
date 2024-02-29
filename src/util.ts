
export function internal_sleep(ms: number) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}

export function cacheOn<T>(store: Record<string, T>, key: string, compute: () => T): T {
    if (store?.[key]) return store[key];
    const value = compute();
    if (store) store[key] = value;
    return value;
}
