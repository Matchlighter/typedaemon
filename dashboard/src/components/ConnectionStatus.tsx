import { mdiClose } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component } from 'react';
import type { ConnectionHealth, ConnectionStore } from '../stores/connection_store';
import '../styles/connection.css';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const p = (n: number) => String(n).padStart(2, '0');

/** Local "HH:MM:SS". */
export function formatClock(at: number): string {
    const d = new Date(at);
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const PILL_LABEL: Record<ConnectionHealth, string> = {
    live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', unreachable: 'Unreachable',
};

export function ConnectionPillView({ health }: { health: ConnectionHealth }) {
    return (
        <span className="conn-pill" role="status" data-state={health}>
            {health === 'reconnecting' || health === 'connecting'
                ? <Spinner size={12} />
                : <span className="conn-dot" aria-hidden />}
            {PILL_LABEL[health]}
        </span>
    );
}

/** Inline "Syncing …" indicator (tab/list refetching after reconnect). */
export function SyncingIndicator({ label = 'Syncing tab…' }: { label?: string }) {
    return <span className="conn-sync" role="status"><Spinner size={12} />{label}</span>;
}

/** Shown while the connection is up but subscriptions are still (re)loading their data. */
@observer
export class ConnectionSyncing extends Component<{ connection: ConnectionStore; label?: string }> {
    render() {
        const { connection, label } = this.props;
        return connection.syncing ? <SyncingIndicator label={label} /> : null;
    }
}

export interface ConnectionBannerViewProps {
    health: ConnectionHealth;
    /** Time of the data still on screen (last heard from server) */
    lastLiveAt: number | undefined;
    onRetry: () => void;
}

export function ConnectionBannerView({ health, lastLiveAt, onRetry }: ConnectionBannerViewProps) {
    if (health === 'live' || health === 'connecting') return null;
    const from = lastLiveAt !== undefined && `data shown is from ${formatClock(lastLiveAt)} and may be stale.`;
    if (health === 'unreachable') {
        return (
            <div className="conn-banner conn-banner-err" role="alert">
                <Icon path={mdiClose} size={14} />
                <span className="conn-msg">TypeDaemon unreachable. Is the add-on running?</span>
                <button type="button" className="btn btn-sm" onClick={onRetry}>Retry</button>
            </div>
        );
    }
    return (
        <div className="conn-banner conn-banner-warn" role="status">
            <Spinner size={14} strokeWidth={1.6} />
            <span className="conn-msg">Reconnecting… {from}</span>
            <button type="button" className="btn btn-sm" onClick={onRetry}>Retry now</button>
        </div>
    );
}

/** Header pill bound to the dashboard's own WS connection. */
@observer
export class ConnectionPill extends Component<{ connection: ConnectionStore }> {
    render() { return <ConnectionPillView health={this.props.connection.health} />; }
}

/** Stale/unreachable banner bound to the connection store; Retry triggers an immediate reconnect. */
@observer
export class ConnectionBanner extends Component<{ connection: ConnectionStore }> {
    render() {
        const { connection } = this.props;
        return <ConnectionBannerView health={connection.health} lastLiveAt={connection.lastLiveAt} onRetry={connection.retryNow} />;
    }
}
