import type { GallerySection } from '../gallery';
import { EntityTable, type EntityTableRow } from './EntityTable';

const ha = { href: '/config/entities', target: '_blank' as const };

const rows: EntityTableRow[] = [
    { key: 'a', entityId: 'sensor.lights_scene_mode', name: 'Scene mode', domain: 'sensor', state: 'evening', linked: true, autoClean: true, persistState: true, ha },
    { key: 'b', entityId: 'light.lights_porch_group', name: 'Porch group', domain: 'light', state: 'on', linked: true, autoClean: true, ha },
    {
        key: 'c', entityId: 'sensor.lights_old_mode', name: 'Old mode (renamed in source)', domain: 'sensor', linked: false, autoClean: true, ha,
        action: <button type="button" className="btn btn-sm btn-danger-outline">Delete from HA</button>,
    },
];

const globalRows: EntityTableRow[] = [
    { ...rows[0], owner: { id: 'lights', href: '#/apps/lights' }, selected: true },
    { ...rows[1], owner: { id: 'lights', href: '#/apps/lights' } },
    { key: 'd', entityId: 'sensor.presence_old', domain: 'sensor', linked: false, owner: { id: 'old_presence', orphan: true, href: '#/apps/old_presence' } },
];

export default {
    title: 'Entity table',
    render: () => (
        <>
            <EntityTable rows={rows} />
            <h3>Global list (owner column, selected row, orphan owner)</h3>
            <EntityTable rows={globalRows} columns={{ owner: true, domain: false, flags: false }} />
        </>
    ),
} satisfies GallerySection;
