import { diffKeyedRows } from "./keyed_rows";
import type { TopicDelta, TopicMap, TopicName, TopicParams, TopicSnapshot } from "./protocol";

/**
 * Server side of a topic. `snapshot` returns current state; `subscribe` starts pushing deltas
 * (call `emit` with the topic's delta type) and returns an unsubscribe fn. Subscribe is called
 * before snapshot is read, so no change is lost; the channel buffers deltas until the snapshot is sent.
 */
export interface TopicProvider<T extends TopicName = TopicName> {
    snapshot(params: TopicParams<T>): TopicSnapshot<T> | Promise<TopicSnapshot<T>>;
    subscribe(params: TopicParams<T>, emit: (delta: TopicDelta<T>) => void): () => void;
}

/** Registry of topic providers. One shared instance per hypervisor; later tickets `register` theirs. */
export class TopicRegistry {
    private providers = new Map<string, TopicProvider<any>>();

    register<T extends TopicName>(topic: T, provider: TopicProvider<T>): () => void {
        if (this.providers.has(topic)) throw new Error(`Dashboard topic already registered: ${topic}`);
        this.providers.set(topic, provider);
        return () => { if (this.providers.get(topic) === provider) this.providers.delete(topic) };
    }

    get(topic: string): TopicProvider<any> | undefined {
        return this.providers.get(topic);
    }
}

export type { TopicMap };

export interface DiffTopicOptions<T extends TopicName, S> {
    /** Current state; undefined if the subject (eg the app) is unknown. May be async */
    read(params: TopicParams<T>): S | undefined | Promise<S | undefined>;
    /** `cb` fires whenever `read(params)` may have changed */
    onChange(params: TopicParams<T>, cb: () => void): () => void;
    /** What changed between two reads (`undefined`: unknown subject); undefined result: nothing to emit */
    diff(prev: S | undefined, next: S | undefined): TopicDelta<T> | undefined;
    /** Snapshot sent for a state; the state itself by default */
    snapshot?(state: S): TopicSnapshot<T>;
    /** What the topic's subject is called in the "Unknown <subject>: <id>" error of an unknown one; `app` by default */
    subject?: string;
}

/**
 * Topic over a source that only says "something may have changed": each change is re-read and diffed against
 * the previous read. Changes are handled strictly in order, so a slow async read never overwrites a newer one.
 */
export function diffTopic<T extends TopicName, S>(opts: DiffTopicOptions<T, S>): TopicProvider<T> {
    return {
        snapshot: async params => {
            const state = await opts.read(params);
            if (state === undefined) throw new Error(`Unknown ${opts.subject ?? 'app'}: ${(params as { id: string }).id}`);
            return opts.snapshot ? opts.snapshot(state) : state as unknown as TopicSnapshot<T>;
        },
        subscribe: (params, emit) => {
            let disposed = false;
            let prev: S | undefined;
            const apply = (next: S | undefined) => {
                if (disposed) return;
                const delta = opts.diff(prev, next);
                prev = next;
                if (delta) emit(delta);
            };
            // Sync reads are handled right away; once an async one is in flight, everything queues behind it
            let inflight = 0;
            let tail: Promise<unknown> = Promise.resolve();
            const later = (step: () => unknown) => {
                inflight++;
                tail = tail.then(step).catch(() => { }).then(() => { inflight-- });
            };
            const first = opts.read(params);
            if (first instanceof Promise) later(async () => { prev = await first });
            else prev = first;
            const off = opts.onChange(params, () => {
                if (inflight) return later(async () => apply(await opts.read(params)));
                const next = opts.read(params);
                if (next instanceof Promise) later(async () => apply(await next));
                else apply(next);
            });
            return () => { disposed = true; off() };
        },
    };
}

const indexRows = <R>(rows: R[], keyOf: (r: R) => string) => new Map(rows.map(r => [keyOf(r), r]));

/** `diffTopic` for state made of rows with a string key (`key` unless `keyOf`), whose deltas are `KeyedDelta`s. An unknown subject has no rows */
export function keyedRowsTopic<T extends TopicName, S, R>(opts: Omit<DiffTopicOptions<T, S>, 'diff'> & {
    /** The state's rows; its `rows` by default */
    rowsOf?: (state: S) => R[];
    keyOf?: (row: R) => string;
}): TopicProvider<T> {
    const keyOf = opts.keyOf ?? ((r: R) => (r as { key: string }).key);
    const rowsOf = (s: S | undefined) => s === undefined ? [] : (opts.rowsOf ?? ((x: S) => (x as unknown as { rows: R[] }).rows))(s);
    return diffTopic<T, S>({
        ...opts,
        diff: (prev, next) => diffKeyedRows(indexRows(rowsOf(prev), keyOf), rowsOf(next), keyOf) as TopicDelta<T> | undefined,
    });
}

/** `diffTopic` for state sent whole on every change (the delta is the fresh snapshot) */
export function replaceTopic<T extends TopicName>(opts: Omit<DiffTopicOptions<T, TopicSnapshot<T>>, 'diff' | 'snapshot'>): TopicProvider<T> {
    return diffTopic<T, TopicSnapshot<T>>({ ...opts, diff: (_prev, next) => next as TopicDelta<T> | undefined });
}
