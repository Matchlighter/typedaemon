import type { ReactNode } from 'react';

/**
 * Dev component sheet (`#/_components`). To add a component, create `<Name>.gallery.tsx` next to it:
 *
 *   import type { GallerySection } from '../gallery';
 *   export default { title: 'State badge', render: () => <>...all variants, loading/empty/error/stale...</> } satisfies GallerySection;
 *
 * Files are auto-discovered (import.meta.glob); no registration needed.
 */
export interface GallerySection {
    title: string;
    render: () => ReactNode;
}

export function loadGallerySections(): GallerySection[] {
    const mods = import.meta.glob<{ default: GallerySection }>('./**/*.gallery.tsx', { eager: true });
    return Object.values(mods).map(m => m.default).sort((a, b) => a.title.localeCompare(b.title));
}
