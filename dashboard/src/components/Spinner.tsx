/** Shared busy ring (3/4 arc, round caps; mock "Connection & sync"). Rotation via `.spin`; colour via currentColor. */
export function Spinner({ size = 12, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg viewBox="0 0 12 12" width={size} height={size} className="spin" aria-hidden>
            <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
    );
}
