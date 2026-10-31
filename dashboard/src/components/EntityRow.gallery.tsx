import type { GallerySection } from '../gallery';
import { EntityRow, type EntityRowProps } from './EntityRow';

const ha = (id: string) => `/config/entities?search=${id}`;

const rows: EntityRowProps[] = [
    { entityId: 'sensor.office_temp', name: 'Office temperature', owner: { id: 'climate' }, state: '21.4', linked: true, persistState: true, href: ha('sensor.office_temp') },
    { entityId: 'light.kitchen_scene', name: 'Kitchen scene', owner: { id: 'lights' }, state: 'on', linked: true, autoClean: true, persistState: true, href: ha('light.kitchen_scene') },
    {
        entityId: 'binary_sensor.old_presence_hall', name: 'Hall presence', owner: { id: 'old_presence', orphan: true }, linked: false, autoClean: true,
        action: <button type="button" className="btn btn-sm btn-danger-outline">Delete from HA</button>,
    },
    { entityId: 'select.some_very_long_entity_identifier_that_must_ellipsise_cleanly', name: 'A long entity name that also needs to truncate', owner: { id: 'lights' }, state: 'a_long_option_value', linked: true },
];

export default {
    title: 'Entity row',
    render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(r => <EntityRow key={r.entityId} {...r} />)}
        </div>
    ),
} satisfies GallerySection;
