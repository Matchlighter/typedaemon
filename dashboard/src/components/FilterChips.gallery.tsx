import type { GallerySection } from '../gallery';
import { FilterChips } from './FilterChips';

export default {
    title: 'FilterChips',
    render: () => (
        <FilterChips label="source" values={['app', 'system']} onChange={() => { }}
            options={[{ value: 'app', label: 'all apps' }, { value: 'plugin', label: 'plugins' }, { value: 'system', label: 'system' }]} />
    ),
} satisfies GallerySection;
