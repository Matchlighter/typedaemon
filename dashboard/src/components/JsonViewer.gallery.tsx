import type { GallerySection } from '../gallery';
import { JsonViewState } from '../stores/json_view_state';
import { JsonViewer } from './JsonViewer';
import { lazy } from './json_model';

const memory = () => new JsonViewState({ get: () => null, set: () => {} });
const sample = {
    name: 'lights',
    enabled: true,
    retries: 3,
    note: null,
    description: 'A very long description string that goes on and on. '.repeat(5),
    scenes: { evening: { brightness: 40, color: [255, 180, 90] }, morning: { brightness: 90, color: [255, 240, 200] } },
    history: lazy({ kind: 'array', count: 48, size: 3174 }),
};
const loader = () => new Promise<unknown>(res => setTimeout(() => res(Array.from({ length: 48 }, (_, i) => ({ t: i, v: i * 2 }))), 600));

export default {
    title: 'JSON viewer',
    render: () => <JsonViewer value={sample} loader={loader} state={memory()} />,
} satisfies GallerySection;
