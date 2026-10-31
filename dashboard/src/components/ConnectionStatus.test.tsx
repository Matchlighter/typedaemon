import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionBannerView, ConnectionPillView, formatClock } from './ConnectionStatus';

const at = new Date(2026, 9, 19, 14, 6, 12).getTime();

describe('formatClock', () => {
    it('is local HH:MM:SS', () => expect(formatClock(at)).toBe('14:06:12'));
});

describe('ConnectionPillView', () => {
    it.each([
        ['live', 'Live'],
        ['connecting', 'Connecting…'],
        ['reconnecting', 'Reconnecting…'],
        ['unreachable', 'Unreachable'],
    ] as const)('%s -> %s', (health, label) => {
        const out = renderToString(<ConnectionPillView health={health} />);
        expect(out).toContain(label);
        expect(out).toContain(`data-state="${health}"`);
        expect(out).toContain('role="status"');
    });
});

describe('ConnectionBannerView', () => {
    it('renders nothing when live or first connecting', () => {
        expect(renderToString(<ConnectionBannerView health="live" lastLiveAt={at} onRetry={() => { }} />)).toBe('');
        expect(renderToString(<ConnectionBannerView health="connecting" lastLiveAt={undefined} onRetry={() => { }} />)).toBe('');
    });

    it('reconnecting shows stale timestamp as role=status', () => {
        const out = renderToString(<ConnectionBannerView health="reconnecting" lastLiveAt={at} onRetry={() => { }} />);
        expect(out).toContain('role="status"');
        expect(out).toContain('data shown is from 14:06:12 and may be stale');
        expect(out).toContain('Retry now');
    });

    it('reconnecting without prior data omits the timestamp', () => {
        const out = renderToString(<ConnectionBannerView health="reconnecting" lastLiveAt={undefined} onRetry={() => { }} />);
        expect(out).toContain('Reconnecting…');
        expect(out).not.toContain('data shown');
    });

    it('unreachable is role=alert with add-on hint and Retry', () => {
        const out = renderToString(<ConnectionBannerView health="unreachable" lastLiveAt={at} onRetry={() => { }} />);
        expect(out).toContain('role="alert"');
        expect(out).toContain('TypeDaemon unreachable. Is the add-on running?');
        expect(out).not.toContain('stale');
    });

    it('retry button invokes onRetry', () => {
        const onRetry = vi.fn();
        const find = (n: any): any => n?.type === 'button' ? n : [].concat(n?.props?.children ?? []).map(find).find(Boolean);
        find(ConnectionBannerView({ health: 'reconnecting', lastLiveAt: at, onRetry })).props.onClick();
        expect(onRetry).toHaveBeenCalledOnce();
    });
});
