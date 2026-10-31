import type { GallerySection } from '../gallery';
import { StatusDot } from './StatusDot';

export default {
    title: 'StatusDot',
    render: () => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {(['ok', 'run', 'err', 'warn', 'off'] as const).map(t => <span key={t} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><StatusDot tone={t} />{t}</span>)}
        </div>
    ),
} satisfies GallerySection;
