import type { GallerySection } from '../gallery';
import { ResumableCard, type ResumableCardProps } from './ResumableCard';

const M = 60_000, H = 60 * M;
const now = Date.now();
const cancel = <button type="button" className="btn btn-sm btn-danger-outline">Cancel…</button>;
const discard = <button type="button" className="btn btn-sm btn-danger-outline">Discard…</button>;

const cards: ResumableCardProps[] = [
    { status: 'suspended', type: 'resumable', owner: 'hvac', method: 'preheat_then_cool', params: ['bedroom', 21], wait: { kind: 'sleep', until: now + 16 * H + 23 * M }, startedAt: now - 9 * H, restarts: 1, action: cancel },
    { status: 'running', type: 'script', owner: 'lights', method: 'scene_transition', params: ['evening', { fade: 30 }], wait: { kind: 'condition', condition: 'binary_sensor.door == "closed"', since: now - 3 * H - 12 * M }, startedAt: now - 3 * H - 12 * M, restarts: 0, action: cancel },
    { status: 'running', type: 'resumable', owner: 'garden', method: 'water_zone', params: [3], startedAt: now - 40 * M, action: cancel },
    { status: 'failed', type: 'resumable', owner: 'hvac', method: 'preheat_then_cool', params: ['bedroom', 21], startedAt: now - 2 * 24 * H, restarts: 3, failure: { error: "TypeError: Cannot read properties of undefined (reading 'setpoint')\n    at hvac/index.ts:48", attempts: 3 }, action: discard },
];

export default {
    title: 'Resumable card',
    render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cards.map((c, i) => <ResumableCard key={i} {...c} />)}
        </div>
    ),
} satisfies GallerySection;
