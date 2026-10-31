/** How often to ping HA. Idle HA is normal; only a missing pong means a dead socket. */
export const HA_PING_INTERVAL_MS = 30_000;
/** How long to wait for a pong (or any other message) after a ping before declaring the socket dead. */
export const HA_PONG_TIMEOUT_MS = 10_000;

export interface HeartbeatOptions {
    /** Send `{type:"ping"}`; resolves on `pong` */
    ping: () => Promise<unknown>;
    /** Whether the socket is currently up (don't ping/judge while the library is already reconnecting) */
    isConnected: () => boolean;
    /** Socket considered dead: force a reconnect */
    onDead: () => void;
    intervalMs?: number;
    timeoutMs?: number;
}

/**
 * Ping/pong liveness watchdog. Any received message (`touch()`) or pong counts as liveness;
 * reconnects only when nothing has been heard within `timeoutMs` of a ping.
 */
export function startHeartbeat(opts: HeartbeatOptions) {
    const { intervalMs = HA_PING_INTERVAL_MS, timeoutMs = HA_PONG_TIMEOUT_MS } = opts;
    let lastSeen = Date.now();
    const touch = () => { lastSeen = Date.now() };
    const pending = new Set<ReturnType<typeof setTimeout>>();

    const timer = setInterval(() => {
        if (!opts.isConnected()) return;
        const sentAt = Date.now();
        opts.ping().then(touch, () => { /* judged by the timeout below */ });
        const check = setTimeout(() => {
            pending.delete(check);
            if (lastSeen < sentAt && opts.isConnected()) opts.onDead();
        }, timeoutMs);
        pending.add(check);
    }, intervalMs);

    return {
        touch,
        stop() {
            clearInterval(timer);
            pending.forEach(clearTimeout);
            pending.clear();
        },
    };
}
