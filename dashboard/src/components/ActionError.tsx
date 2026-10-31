import '../styles/appdetail.css';

/** The failure of an action (`ConfirmedAction.error`), once it has one (role=alert). `className` restyles it (e.g. the palette's toast); `onClick` is for dismissing */
export function ActionError({ error, className = 'appd-action-error', onClick }: { error: string | undefined; className?: string; onClick?: () => void }) {
    return error ? <div className={className} role="alert" onClick={onClick}>{error}</div> : null;
}
