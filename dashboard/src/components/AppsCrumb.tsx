import { mdiChevronLeft } from '@mdi/js';
import { RouteStore } from '../stores/route_store';
import { Icon } from './Icon';

/** "< Apps" breadcrumb above an app detail heading (hidden on phone, where the top bar has the back link) */
export function AppsCrumb() {
    return <a className="appd-crumb" href={RouteStore.href('/apps')}><Icon path={mdiChevronLeft} size={16} />Apps</a>;
}
