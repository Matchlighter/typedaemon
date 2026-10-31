import type { ReactNode } from 'react';
import '../styles/liststates.css';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/** `loading` = request/response fetch; the rest mirror topic subscription status (`TopicStore.status`). */
export type ListStatus = 'loading' | 'syncing' | 'live' | 'stale' | 'error';

export interface ListStatesProps {
    status: ListStatus;
    /** True when loaded and there is nothing to list */
    isEmpty?: boolean;
    /** Empty-state copy: bold title + one line on what would populate the list. Needed with `isEmpty` */
    empty?: { title: string; hint: ReactNode; /** MDI icon path shown above the title */ icon?: string };
    /** Wrap the empty state in a bordered card (for lists that are otherwise cards/tables) */
    card?: boolean;
    /** Error-state copy; `detail` is shown mono (e.g. `TopicStore.error`) */
    error?: { title: string; detail?: string };
    /** Renders the `Try again` button when given */
    onRetry?: () => void;
    /** Label for the syncing line */
    syncingLabel?: string;
    children?: ReactNode;
}

/** Wrapper every list uses for loading / syncing / empty / error / stale (design.md "List states"). */
export function ListStates({ status, isEmpty, empty, card, error, onRetry, syncingLabel = 'Syncing…', children }: ListStatesProps) {
    switch (status) {
        case 'loading':
            return (
                <div className="liststate-loading" aria-busy="true" aria-label="Loading">
                    {[80, 60, 70].map(w => <div key={w} className="liststate-bar" style={{ width: `${w}%` }} />)}
                </div>
            );
        case 'syncing':
            return (
                <div className="liststate-syncing" role="status">
                    <Spinner size={14} />{syncingLabel}
                </div>
            );
        case 'error':
            return (
                <div className="liststate-center" role="alert">
                    <div className="liststate-title liststate-err">{error?.title ?? "Couldn't load"}</div>
                    {error?.detail && <code className="liststate-detail">{error.detail}</code>}
                    {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}
                </div>
            );
    }
    if (isEmpty && empty) {
        return (
            <div className={card ? 'liststate-center card' : 'liststate-center'}>
                {empty.icon && <Icon path={empty.icon} size={24} className="liststate-icon" />}
                <div className="liststate-title">{empty.title}</div>
                <div className="liststate-hint">{empty.hint}</div>
            </div>
        );
    }
    // Same element live and stale, so going stale (a dropped connection) doesn't remount the children and lose their own subscriptions' data
    return <div className={status === 'stale' ? 'liststate-stale' : 'liststate-live'}>{children}</div>;
}
