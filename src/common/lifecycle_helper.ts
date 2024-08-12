
type Cleaner = () => void;

interface MetaOpts {
    tags: string[];
}

abstract class BaseLifecycleHelper {
    private orderedGroups: Record<string | symbol, OrderedLifecycleHelper> = {}
    orderedGroup(name: string | symbol) {
        if (!this.orderedGroups[name]) {
            const lh = this.orderedGroups[name] = new OrderedLifecycleHelper();
            this.push(() => lh.cleanup());
            return lh;
        }
        return this.orderedGroups[name]
    }

    private unorderedGroups: Record<string | symbol, UnorderedLifecycleHelper> = {}
    unorderedGroup(name: string | symbol) {
        if (!this.unorderedGroups[name]) {
            const lh = this.unorderedGroups[name] = new UnorderedLifecycleHelper();
            this.push(() => lh.cleanup());
            return lh;
        }
        return this.unorderedGroups[name]
    }

    protected abstract push(cleaner: Cleaner, meta?: Partial<MetaOpts>);
    abstract remove(cleaner: Cleaner);

    protected abstract _cleanup(checkpoint?: Set<Cleaner>): Promise<Cleaner[]>;
    protected abstract _iterate(): Generator<Cleaner>;

    async cleanup(options?: { except_tags?: string[], to_checkpoint?: string }) {
        const keep_set = new Set<Cleaner>();

        if (options?.except_tags) {
            const etags = new Set(options.except_tags);
            for (let [cl, meta] of this.cleaner_meta.entries()) {
                if (meta.tags.find(t => etags.has(t))) keep_set.add(cl);
            }
        }

        if (options?.to_checkpoint) {
            const checkset = this.checkpoints[options?.to_checkpoint];
            for (let cl of checkset) {
                keep_set.add(cl);
            }
            delete this.checkpoints[options?.to_checkpoint];
        }

        const removed = await this._cleanup(keep_set);
        for (let rcl of removed) {
            this.cleaner_meta.delete(rcl);
        }
    }

    private cleaner_meta: Map<Cleaner, MetaOpts> = new Map();

    protected _cleanup_added(cleaner: Cleaner, meta: Partial<MetaOpts>) {
        this.cleaner_meta.set(cleaner, {
            tags: [],
            ...meta,
        })
    }
    protected _cleanup_removed(cleaner: Cleaner) {
        this.cleaner_meta.delete(cleaner);
    }

    private checkpoints: Record<string, Set<Cleaner>> = {};

    set_checkpoint(name: string) {
        const curset = new Set<Cleaner>();
        for (let cln of this._iterate()) {
            curset.add(cln);
        }
        this.checkpoints[name] = curset;
    }

    /** Add a cleanup function and return a wrapped version that can be called manually */
    addExposed<T extends Cleaner>(cleaner: T, meta?: Partial<MetaOpts>): T {
        const wrapped_cleaner = () => {
            try {
                return cleaner();
            } finally {
                this.remove(cleaner)
            }
        }

        this.push(cleaner, meta);

        return wrapped_cleaner as any;
    }
}

class OrderedLifecycleHelper extends BaseLifecycleHelper {
    private cleanups: Cleaner[] = [];

    // TODO Add Priority queue type stuff?

    append(cleaner: Cleaner, meta?: Partial<MetaOpts>) {
        this._cleanup_added(cleaner, meta);
        this.cleanups.push(cleaner);
    }

    prepend(cleaner: Cleaner, meta?: Partial<MetaOpts>) {
        this._cleanup_added(cleaner, meta);
        this.cleanups.unshift(cleaner);
    }

    protected push(cleaner: Cleaner, meta?: Partial<MetaOpts>) {
        this._cleanup_added(cleaner, meta);
        this.cleanups.push(cleaner);
    }

    remove(cleaner: Cleaner) {
        this._cleanup_removed(cleaner);
        const index = this.cleanups.indexOf(cleaner);
        if (index > -1) {
            this.cleanups.splice(index, 1);
        }
    }

    protected *_iterate(): Generator<Cleaner, any, unknown> {
        for (let cln of this.cleanups) yield cln;
    }

    protected async _cleanup(checkpoint?: Set<Cleaner>) {
        const removed: Cleaner[] = [];
        const new_list: Cleaner[] = [];
        // TODO Determine a way that some cleanups can run in parallel?
        while (true) {
            const c = this.cleanups.pop();
            if (!c) break;
            if (checkpoint && checkpoint.has(c)) {
                new_list.unshift(c);
            } else {
                removed.push(c);
                try {
                    await c();
                } catch (ex) {
                    console.error("Disposer failed:", ex);
                }
            }
        }
        this.cleanups = new_list;
        return removed;
    }
}

class UnorderedLifecycleHelper extends BaseLifecycleHelper {
    private cleanups = new Set<Cleaner>();

    push(cleaner: Cleaner, meta?: Partial<MetaOpts>) {
        this._cleanup_added(cleaner, meta);
        this.cleanups.add(cleaner);
        return () => this.cleanups.delete(cleaner);
    }

    pop(cleaner: Cleaner) {
        this._cleanup_removed(cleaner);
        this.cleanups.delete(cleaner);
    }

    remove(cleaner: Cleaner) {
        this.pop(cleaner);
    }

    protected *_iterate(): Generator<Cleaner, any, unknown> {
        for (let cln of this.cleanups) yield cln;
    }

    protected async _cleanup(checkpoint?: Set<Cleaner>) {
        const removed: Cleaner[] = [];
        const new_set: Set<Cleaner> = new Set();

        for (let c of this.cleanups) {
            if (checkpoint && checkpoint.has(c)) {
                new_set.add(c);
            } else {
                removed.push(c);
                try {
                    await c();
                } catch (ex) {
                    console.error("Disposer failed:", ex);
                }
            }
        }

        this.cleanups = new_set;
        return removed;
    }
}

export class LifecycleHelper extends OrderedLifecycleHelper { }
