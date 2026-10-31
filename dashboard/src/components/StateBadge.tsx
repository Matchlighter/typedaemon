import { mdiAlertOutline, mdiCheck, mdiClose, mdiExclamation, mdiLoading } from '@mdi/js';
import '../styles/badge.css';
import { Icon } from './Icon';

export type BadgeState =
    | { kind: 'app'; state: 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead' | 'orphan'; override?: boolean; label?: string }
    | { kind: 'entity'; state: 'linked' | 'unlinked'; label?: string }
    | { kind: 'resumable'; state: 'running' | 'suspended' | 'failed'; label?: string }
    | { kind: 'call'; state: 'pending' | 'started' | 'returning'; label?: string }
    | { kind: 'plugin'; state: 'connected' | 'reconnecting' | 'disconnected' | 'listening'; label?: string }
    | { kind: 'hypervisor'; state: 'running' | 'shutting_down'; label?: string }
    | { kind: 'result'; state: 'ok' | 'error'; label?: string };

export type BadgeTone = 'ok' | 'run' | 'off' | 'err' | 'warn' | 'outline-warn';
export type BadgeIcon = 'check' | 'x' | 'warn' | 'bang' | 'arc' | 'square' | 'none';

export interface BadgeSpec { tone: BadgeTone; icon: BadgeIcon; label: string; animated: boolean; ring: boolean; title?: string }

const spec = (tone: BadgeTone, icon: BadgeIcon, label: string, extra: Partial<BadgeSpec> = {}): BadgeSpec =>
    ({ tone, icon, label, animated: icon === 'arc', ring: false, ...extra });

const OVERRIDE_TITLE = 'Stopped from the dashboard — resets on next config reload';

/** Pure state -> visual mapping (design.md "State colors"). */
export function badgeSpec(s: BadgeState): BadgeSpec {
    const out = baseSpec(s);
    return s.label ? { ...out, label: s.label } : out;
}

function baseSpec(s: BadgeState): BadgeSpec {
    switch (s.kind) {
        case 'app':
            switch (s.state) {
                case 'started': return spec('ok', 'check', 'started');
                case 'initializing': case 'compiling': case 'starting': return spec('run', 'arc', s.state);
                case 'stopping': return spec('off', 'square', 'stopping');
                case 'stopped':
                    return s.override
                        ? spec('off', 'square', 'stopped · override', { ring: true, title: OVERRIDE_TITLE })
                        : spec('off', 'square', 'stopped');
                case 'dead': return spec('err', 'x', 'dead');
                case 'orphan': return spec('warn', 'warn', 'orphan');
            }
        case 'entity':
            return s.state === 'linked' ? spec('ok', 'none', 'linked') : spec('outline-warn', 'none', 'unlinked');
        case 'resumable':
            if (s.state === 'running') return spec('run', 'none', 'running');
            if (s.state === 'suspended') return spec('off', 'none', 'suspended');
            return spec('err', 'bang', 'failed to resume');
        case 'call':
            if (s.state === 'started') return spec('run', 'arc', 'started');
            if (s.state === 'returning') return spec('run', 'arc', 'returning');
            return spec('off', 'none', 'pending');
        case 'plugin':
            if (s.state === 'connected') return spec('ok', 'none', 'connected');
            if (s.state === 'listening') return spec('ok', 'check', 'listening');
            if (s.state === 'reconnecting') return spec('run', 'arc', 'reconnecting');
            return spec('err', 'x', 'disconnected');
        case 'hypervisor': return s.state === 'running' ? spec('ok', 'check', 'running') : spec('run', 'arc', 'shutting down');
        case 'result': return s.state === 'ok' ? spec('ok', 'check', 'ok') : spec('err', 'x', 'error');
    }
}

const PATHS: Record<Exclude<BadgeIcon, 'none' | 'arc'>, string> = {
    check: mdiCheck,
    x: mdiClose,
    warn: mdiAlertOutline,
    bang: mdiExclamation,
    // Small rounded square (mock: 6x6 rx1.2 in a 12 box).
    square: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
};

function BadgeGlyph({ icon }: { icon: BadgeIcon }) {
    if (icon === 'none') return null;
    // Partial ring; rotates via CSS (stills under prefers-reduced-motion, arc shape still signals "in progress").
    if (icon === 'arc') return <Icon path={mdiLoading} className="badge-arc" />;
    return <Icon path={PATHS[icon]} />;
}

export function StateBadge(props: BadgeState) {
    const b = badgeSpec(props);
    const cls = ['badge', `badge-${b.tone}`, b.animated && 'badge-spin', b.ring && 'badge-ring', b.icon === 'none' && 'badge-textonly'].filter(Boolean).join(' ');
    return <span className={cls} title={b.title}><BadgeGlyph icon={b.icon} />{b.label}</span>;
}
