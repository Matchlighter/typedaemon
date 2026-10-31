import type { GallerySection } from '../gallery';
import { VirtualList } from './VirtualList';

const items = Array.from({ length: 20_000 }, (_, i) => i + 1);

export default {
    title: 'VirtualList',
    render: () => (
        <VirtualList label="Demo rows" items={items} itemKey={n => String(n)} estimate={36} gap={4}
            render={n => <div className="card" style={{ padding: '8px 12px' }}>Row {n}</div>} />
    ),
} satisfies GallerySection;
