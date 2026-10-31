import type { GallerySection } from '../gallery';
import { Clock, sharedClock } from '../stores/clock';
import { RelativeTime } from './RelativeTime';

const M = 60_000, H = 60 * M;
const paused = new Clock();
paused.setPaused(true);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}><span style={{ width: 160 }} className="lbl">{label}</span>{children}</div>
);

export default {
    title: 'Relative time',
    render: () => {
        const now = Date.now();
        return (
            <>
                <Row label="Past"><RelativeTime at={now - 3 * M} /></Row>
                <Row label="Yesterday"><RelativeTime at={now - 26 * H} /></Row>
                <Row label="Future (minutes)"><RelativeTime at={now + 7 * M + 48_000} /></Row>
                <Row label="Future (hours)"><RelativeTime at={now + 2 * H + 14 * M} /></Row>
                <Row label="Live countdown (30s)"><RelativeTime at={now + 30_000} /></Row>
                <Row label="Stale (paused, dim)"><RelativeTime at={now - 3 * M} clock={paused} /></Row>
                <Row label="Shared clock">
                    <button className="btn" onClick={() => sharedClock.setPaused(!sharedClock.paused)}>Toggle pause</button>
                </Row>
            </>
        );
    },
} satisfies GallerySection;
