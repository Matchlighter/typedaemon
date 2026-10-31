import { mdiInformationOutline } from '@mdi/js';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Blue inline notice (icon + text). Styles in app.css (`.banner`). */
export function InfoBanner({ children }: { children: ReactNode }) {
    return (
        <div className="banner" role="note">
            <Icon path={mdiInformationOutline} size={16} />
            <span>{children}</span>
        </div>
    );
}
