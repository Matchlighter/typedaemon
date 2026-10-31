import { mdiKeyboard } from '@mdi/js';
import type { GallerySection } from '../gallery';
import { CommandPalette } from './CommandPalette';
import { Icon } from './Icon';
import { matchRange, type PaletteProvider } from './palette_model';

/** Stub provider over a static list; real ones come with td-arf.30. */
const stub = (id: string, title: string, rows: [string, string][]): PaletteProvider => ({
    id, title,
    search: q => rows.filter(([l]) => matchRange(l, q)).map(([label, sublabel]) => ({
        id: `${id}:${label}`, label, sublabel, run: () => { console.info('palette:', title, label); },
    })),
});

const providers = [
    stub('entities', 'Entities', [['light.kitchen_lights', 'lights'], ['sensor.living_room_temp', 'climate'], ['binary_sensor.old_presence_home', 'old_presence']]),
    stub('storage', 'Storage keys', [['lights / last_scene', 'string'], ['presence / last_seen', 'number']]),
    stub('actions', 'Actions', [['Restart lights', 'app action'], ['Restart notifier', 'app action']]),
];

export default {
    title: 'Command palette',
    render: () => (
        <>
            <p><Icon path={mdiKeyboard} size={16} /> Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> to open (stub providers; selections log to the console).</p>
            <CommandPalette providers={providers} />
        </>
    ),
} satisfies GallerySection;
