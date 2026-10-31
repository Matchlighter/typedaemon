import type { TopicName, TopicParams } from '@protocol';
import { makeObservable, observable, runInAction } from 'mobx';
import type { Store } from '@matchlighter/meta_components';
import type { ConnectionStore, SubscriptionStatus, TopicSubscription } from './connection_store';

/**
 * Component-friendly topic handle. Use as a meta_components `@store` field so the subscription
 * follows the component's mount/unmount:
 *
 *   @store sys = new TopicStore(app.connection, 'system');
 *   render() { const { data, status } = this.sys; ... }   // inside an observer class
 */
export class TopicStore<T extends TopicName> implements Store {
    private sub: TopicSubscription<T> | undefined = undefined;

    constructor(
        private conn: ConnectionStore,
        private topic: T,
        private params?: TopicParams<T>,
    ) { makeObservable<TopicStore<T>, 'sub'>(this, { sub: observable.ref }); }

    /** Undefined until activated (mounted) and the first snapshot arrives */
    get data() { return this.sub?.data; }
    get status() { return this.sub?.status ?? 'syncing'; }
    get error() { return this.sub?.error; }
    /**
     * What a list of this topic shows (`<ListStates status>`): without data yet only `error` is told apart from `syncing`;
     * with data, `live`/`stale` (and `error`).
     */
    get listStatus(): SubscriptionStatus {
        if (this.data) return this.status;
        return this.status === 'error' ? 'error' : 'syncing';
    }

    activate() {
        const sub = this.conn.subscribe(this.topic, this.params);
        runInAction(() => { this.sub = sub; });
        return () => { sub.dispose(); runInAction(() => { this.sub = undefined; }); };
    }
}

/** `listStatus` of a page that needs several topics: `error` if any failed, `syncing` until all have data, then `stale` if any is */
export function combinedListStatus(...stores: TopicStore<any>[]): SubscriptionStatus {
    const all = stores.map(s => s.listStatus);
    if (all.includes('error')) return 'error';
    if (all.includes('syncing')) return 'syncing';
    return all.includes('stale') ? 'stale' : 'live';
}
