import type { GallerySection } from '../gallery';
import { mdiClockOutline } from '@mdi/js';
import { ListStates } from './ListStates';

const empty = { title: 'No HTTP handlers', hint: 'Routes appear when the app calls this.http.get() or mounts static files.' };
const rows = <ul style={{ margin: 0, paddingLeft: 18 }}><li>/app/lights/api/scenes</li><li>/app/lights/ui/*</li></ul>;

const cells: [string, React.ComponentProps<typeof ListStates>][] = [
    ['Loading', { status: 'loading', empty }],
    ['Syncing', { status: 'syncing', empty }],
    ['Empty', { status: 'live', isEmpty: true, empty }],
    ['Empty, card + icon', { status: 'live', isEmpty: true, card: true, empty: { ...empty, icon: mdiClockOutline } }],
    ['Error', { status: 'error', empty, error: { title: "Couldn't load storage", detail: 'EACCES store.journal' }, onRetry: () => {} }],
    ['Stale', { status: 'stale', empty }],
];

export default {
    title: 'List states',
    render: () => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {cells.map(([name, p]) => (
                <div key={name} className="card">
                    <div className="lbl">{name}</div>
                    <ListStates {...p}>{rows}</ListStates>
                </div>
            ))}
        </div>
    ),
} satisfies GallerySection;
