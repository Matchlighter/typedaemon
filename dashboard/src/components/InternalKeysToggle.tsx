/** "Show/Hide internal keys (N)" toggle of a storage list; renders nothing when there are none. `checkbox` renders a labelled checkbox instead of a button. */
export function InternalKeysToggle({ count, shown, onToggle, checkbox }: { count: number; shown: boolean; onToggle: () => void; checkbox?: boolean }) {
    if (count === 0) return null;
    if (checkbox) {
        return (
            <label className="check">
                <input type="checkbox" checked={shown} onChange={onToggle} />
                Show internal keys ({count})
            </label>
        );
    }
    return (
        <button type="button" className="btn btn-sm" aria-pressed={shown} onClick={onToggle}>
            {shown ? 'Hide' : 'Show'} internal keys ({count})
        </button>
    );
}
