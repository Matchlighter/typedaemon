/** Says why entity states are dimmed: the plugin they come from has lost its link, so they are last-known values */
export function PluginStaleNote({ plugins }: { plugins: Iterable<string> }) {
    const ids = [...plugins];
    if (ids.length === 0) return null;
    return (
        <p className="note plugin-stale-note" role="status">
            Home Assistant link down ({ids.join(', ')}): states shown are last known and may be out of date.
        </p>
    );
}
