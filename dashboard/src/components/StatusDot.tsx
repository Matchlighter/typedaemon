import type { BadgeTone } from './StateBadge';
import '../styles/status_dot.css';

/** Small colored dot for dense lists; takes the color family of the state it stands for (see `badgeSpec(...).tone`). Decorative: the state must be in text next to it. */
export function StatusDot({ tone }: { tone: BadgeTone }) {
    return <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />;
}
