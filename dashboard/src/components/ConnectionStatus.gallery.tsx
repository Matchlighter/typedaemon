import type { GallerySection } from '../gallery';
import { ConnectionBannerView, ConnectionPillView, SyncingIndicator } from './ConnectionStatus';

const from = new Date().setHours(14, 6, 12, 0);

export default {
    title: 'Connection & sync',
    render: () => (
        <div style={{ display: 'grid', gap: 12 }}>
            <ConnectionBannerView health="reconnecting" lastLiveAt={from} onRetry={() => { }} />
            <ConnectionBannerView health="unreachable" lastLiveAt={from} onRetry={() => { }} />
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <ConnectionPillView health="live" />
                <ConnectionPillView health="reconnecting" />
                <SyncingIndicator />
                <span style={{ color: 'var(--text2)', fontSize: 12 }}>Stale lists dim to 60% and pause countdowns.</span>
            </div>
        </div>
    ),
} satisfies GallerySection;
