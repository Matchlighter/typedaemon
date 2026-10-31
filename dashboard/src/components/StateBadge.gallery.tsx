import type { GallerySection } from '../gallery';
import { StateBadge, type BadgeState } from './StateBadge';

const groups: [string, BadgeState[]][] = [
    ['App lifecycle', [
        ...(['initializing', 'compiling', 'starting', 'started', 'stopping', 'stopped', 'dead', 'orphan'] as const).map(state => ({ kind: 'app', state }) as BadgeState),
        { kind: 'app', state: 'stopped', override: true },
    ]],
    ['Entity link', [{ kind: 'entity', state: 'linked' }, { kind: 'entity', state: 'unlinked' }]],
    ['Resumable / call', [{ kind: 'resumable', state: 'running' }, { kind: 'resumable', state: 'suspended' }, { kind: 'resumable', state: 'failed' }, { kind: 'call', state: 'pending' }]],
    ['Plugin', [{ kind: 'plugin', state: 'connected' }, { kind: 'plugin', state: 'reconnecting' }, { kind: 'plugin', state: 'disconnected' }, { kind: 'plugin', state: 'listening' }]],
    ['Result', [{ kind: 'result', state: 'ok' }, { kind: 'result', state: 'error', label: 'last: error' }]],
];

export default {
    title: 'State badge',
    render: () => (
        <>
            {groups.map(([name, items]) => (
                <div key={name} style={{ marginBottom: 12 }}>
                    <div className="lbl">{name}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        {items.map((s, i) => <StateBadge key={i} {...s} />)}
                    </div>
                </div>
            ))}
        </>
    ),
} satisfies GallerySection;
