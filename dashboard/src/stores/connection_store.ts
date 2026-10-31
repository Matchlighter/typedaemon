import type { ActionName, ActionParams, ActionResult, ClientMessage, ServerMessage, TopicDelta, TopicName, TopicParams, TopicSnapshot } from '@protocol';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { TOPIC_REDUCERS, type TopicReducer } from './topic_reducers';

/** The subset of WebSocket we use (lets tests inject a fake). */
export interface SocketLike {
    send(raw: string): void;
    close(): void;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onmessage: ((e: { data: string }) => void) | null;
}

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';
/** User-facing summary: `unreachable` = several consecutive failed reconnect attempts */
export type ConnectionHealth = 'connecting' | 'live' | 'reconnecting' | 'unreachable';
/** Consecutive failed connection attempts before `health` becomes `unreachable` */
export const UNREACHABLE_AFTER_FAILURES = 3;
/** syncing = no snapshot yet; live; stale = disconnected, showing last-known data; error = server rejected */
export type SubscriptionStatus = 'syncing' | 'live' | 'stale' | 'error';

export interface ConnectionStoreOptions {
    url: string;
    createSocket?: (url: string) => SocketLike;
    minBackoffMs?: number;
    maxBackoffMs?: number;
}

/** Observable handle for one topic subscription. Call `dispose()` when done (refcounted). */
export class TopicSubscription<T extends TopicName = TopicName> {
    status: SubscriptionStatus = 'syncing';
    data: TopicSnapshot<T> | undefined = undefined;
    error: string | undefined = undefined;

    /** @internal */
    refs = 0;
    /** @internal */
    constructor(
        readonly id: number,
        readonly topic: T,
        readonly params: TopicParams<T>,
        private onDispose: (s: TopicSubscription<T>) => void,
    ) {
        makeAutoObservable(this, { data: observable.ref, id: false, topic: false, params: false, refs: false } as any, { autoBind: true });
    }

    /** @internal */
    _snapshot(data: TopicSnapshot<T>) { this.data = data; this.status = 'live'; this.error = undefined; }
    /** @internal */
    _delta(delta: TopicDelta<T>) {
        if (this.data === undefined) return;
        this.data = (TOPIC_REDUCERS[this.topic] as TopicReducer<T>)(this.data, delta, this.params);
    }
    /** @internal */
    _stale() { if (this.status === 'live') this.status = 'stale'; else if (this.status !== 'error') this.status = this.data === undefined ? 'syncing' : 'stale'; }
    /** @internal */
    _error(message: string) { this.status = 'error'; this.error = message; }

    dispose() { this.onDispose(this); }
}

/**
 * Single admin-websocket connection. Transparent reconnect (exponential backoff) and resubscribe;
 * identical (topic, params) subscriptions share one wire subscription and one `TOPIC_REDUCERS` entry.
 */
export class ConnectionStore {
    status: ConnectionStatus = 'connecting';
    /** Epoch ms of the last time the server was heard from; frozen while disconnected (the "data shown is from" time) */
    lastLiveAt: number | undefined = undefined;
    /** Consecutive failed connection attempts; reset on open */
    failures = 0;

    private socket?: SocketLike;
    private subs = new Map<number, TopicSubscription<any>>();
    private byKey = new Map<string, TopicSubscription<any>>();
    private calls = new Map<number, { resolve: (data?: any) => void; reject: (e: Error) => void }>();
    private nextId = 1;
    private backoff: number;
    private retryTimer?: ReturnType<typeof setTimeout>;
    private disposed = false;

    constructor(private opts: ConnectionStoreOptions) {
        this.backoff = opts.minBackoffMs ?? 500;
        makeAutoObservable<ConnectionStore, any>(this, { socket: false, subs: false, byKey: false, calls: false, opts: false, retryTimer: false }, { autoBind: true });
        this.connect();
    }

    /** Global stale flag: data on screen may be out of date (consumed by lists/countdowns). */
    get stale() { return this.status !== 'open'; }

    /** Connected but at least one subscription is still awaiting its (re)subscribe snapshot. */
    get syncing() {
        if (this.status !== 'open') return false;
        for (const sub of this.subs.values()) if (sub.status === 'syncing' || sub.status === 'stale') return true;
        return false;
    }

    get health(): ConnectionHealth {
        if (this.status === 'open') return 'live';
        if (this.failures >= UNREACHABLE_AFTER_FAILURES) return 'unreachable';
        return this.status;
    }

    /** Skip the backoff wait and reconnect now. No-op unless waiting on a backoff timer. */
    retryNow() {
        if (this.disposed || this.retryTimer === undefined) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.connect();
    }

    subscribe<T extends TopicName>(topic: T, params?: TopicParams<T>): TopicSubscription<T> {
        const key = JSON.stringify([topic, params ?? null]);
        let sub = this.byKey.get(key) as TopicSubscription<T> | undefined;
        if (!sub) {
            sub = new TopicSubscription(this.nextId++, topic, params as TopicParams<T>, s => this.release(s, key));
            this.subs.set(sub.id, sub);
            this.byKey.set(key, sub);
            if (this.status === 'open') this.sendSubscribe(sub);
        }
        sub.refs++;
        return sub;
    }

    /** Run a server action; resolves with its result (see `ActionResultMap`). Rejects with the server's message, or if the connection is down / drops before the result. */
    call<N extends ActionName>(action: N, params: ActionParams<N>): Promise<ActionResult<N>> {
        if (this.status !== 'open') return Promise.reject(new Error('Not connected to TypeDaemon'));
        return new Promise<ActionResult<N>>((resolve, reject) => {
            const id = this.nextId++;
            this.calls.set(id, { resolve, reject });
            this.send({ type: 'call', id, action, params });
        });
    }

    dispose() {
        this.disposed = true;
        clearTimeout(this.retryTimer);
        this.socket?.close();
    }

    private release(sub: TopicSubscription<any>, key: string) {
        if (--sub.refs > 0) return;
        this.subs.delete(sub.id);
        this.byKey.delete(key);
        if (this.status === 'open') this.send({ type: 'unsubscribe', id: sub.id });
    }

    private send(msg: ClientMessage) { this.socket?.send(JSON.stringify(msg)); }
    private sendSubscribe(sub: TopicSubscription<any>) {
        this.send({ type: 'subscribe', id: sub.id, topic: sub.topic, params: sub.params });
    }

    private connect() {
        if (this.disposed) return;
        const socket = (this.opts.createSocket ?? (u => new WebSocket(u) as unknown as SocketLike))(this.opts.url);
        this.socket = socket;
        socket.onopen = () => runInAction(() => {
            this.status = 'open';
            this.failures = 0;
            this.lastLiveAt = Date.now();
            this.backoff = this.opts.minBackoffMs ?? 500;
            for (const sub of this.subs.values()) this.sendSubscribe(sub);
        });
        socket.onmessage = e => runInAction(() => this.handle(JSON.parse(e.data)));
        socket.onclose = () => runInAction(() => {
            if (this.socket !== socket) return;
            this.socket = undefined;
            this.status = 'reconnecting';
            this.failures++;
            for (const sub of this.subs.values()) sub._stale();
            for (const call of this.calls.values()) call.reject(new Error('Connection lost before the action finished'));
            this.calls.clear();
            if (this.disposed) return;
            const delay = this.backoff;
            this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 10_000);
            this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.connect(); }, delay);
        });
    }

    private handle(msg: ServerMessage) {
        this.lastLiveAt = Date.now();
        if (msg.type === 'result') {
            const call = this.calls.get(msg.id);
            this.calls.delete(msg.id);
            if (msg.ok) call?.resolve(msg.data); else call?.reject(new Error(msg.message));
            return;
        }
        const sub = this.subs.get(msg.id);
        if (!sub) return;
        if (msg.type === 'snapshot') sub._snapshot(msg.data as any);
        else if (msg.type === 'delta') sub._delta(msg.data as any);
        else if (msg.type === 'error') sub._error(msg.message);
    }
}

/** WS URL relative to the page URL, so HA Ingress path prefixes are preserved. Never use an absolute `/ws`. */
export function defaultWsUrl(loc: Pick<Location, 'href'> = location): string {
    const u = new URL('ws', loc.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.hash = '';
    return u.toString();
}
