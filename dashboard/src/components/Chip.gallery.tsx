import type { GallerySection } from '../gallery';
import { Chip } from './Chip';

export default {
    title: 'Chip',
    render: () => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Chip>internal</Chip>
            <Chip mono>auto_clean</Chip>
            <Chip accent role="status">changed</Chip>
        </div>
    ),
} satisfies GallerySection;
