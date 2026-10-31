import type { GallerySection } from '../gallery';
import { RowMenu } from './RowMenu';

export default {
    title: 'RowMenu',
    render: () => <RowMenu label="More actions for lights" items={[{ key: 'logs', label: 'Open logs', href: '#/apps/lights/logs' }, { key: 'stop', label: 'Stop', onSelect: () => { } }]} />,
} satisfies GallerySection;
