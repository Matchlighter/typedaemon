import type { GallerySection } from '../gallery';
import { Segmented } from './Segmented';

export default {
    title: 'Segmented',
    render: () => (
        <Segmented label="Demo" value="all" onChange={() => { }}
            options={[{ value: 'all', label: 'All', count: 7 }, { value: 'running', label: 'Running', count: 5 }, { value: 'dead', label: 'Dead', count: 1, err: true }]} />
    ),
} satisfies GallerySection;
