import type { GallerySection } from '../gallery';
import { ProportionBar } from './ProportionBar';

export default {
    title: 'ProportionBar',
    render: () => (
        <div style={{ display: 'grid', gap: 12, width: 240 }}>
            <ProportionBar segments={[{ count: 2, tone: 'ok' }, { count: 1, tone: 'run' }, { count: 1, tone: 'err' }]} />
            <ProportionBar segments={[{ count: 3, tone: 'ok' }]} />
            <ProportionBar segments={[{ count: 1, tone: 'ok' }, { count: 2, tone: 'off' }]} />
        </div>
    ),
} satisfies GallerySection;
