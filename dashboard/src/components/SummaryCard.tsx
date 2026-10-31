import type { ReactNode } from 'react';
import '../styles/appdetail.css';

/** Linked overview card: label, big value, optional warning and note */
export function SummaryCard({ id, href, label, value, unit, note, warn }: { id: string; href: string; label: string; value: ReactNode; /** Muted, beside the value (`keys · 2.4 KB`) */ unit?: ReactNode; note?: ReactNode; warn?: ReactNode }) {
    return (
        <a className="card appd-sum" data-card={id} href={href}>
            <span className="lbl">{label}</span>
            <span className="appd-sum-value">{value}{unit && <> <span className="appd-sum-unit">{unit}</span></>}</span>
            {warn && <span className="appd-sum-warn">{warn}</span>}
            {note && <span className="appd-sum-note">{note}</span>}
        </a>
    );
}
