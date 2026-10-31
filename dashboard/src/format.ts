/** Display formatting shared by views and components */

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** `1 file`, `3 files`; irregular plurals pass `many` */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A missing value as an em dash */
export const dash = (v: unknown): string => v == null ? '—' : String(v);

/** Elapsed time, two units: "42s", "7m 48s", "2h 14m", "3d 4h" */
export function formatDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const [d, h, m] = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60];
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
}
