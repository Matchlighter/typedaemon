
type Cleaner = () => void;

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

    protected abstract push(cleaner: Cleaner);
    abstract remove(cleaner: Cleaner);
    abstract cleanup();
}

class OrderedLifecycleHelper extends BaseLifecycleHelper {
    private cleanups: Cleaner[] = [];

    // TODO Add Priority queue type stuff?

    append(cleaner: Cleaner) {
        this.cleanups.push(cleaner);
    }

    prepend(cleaner: Cleaner) {
        this.cleanups.unshift(cleaner);
    }

    protected push(cleaner: Cleaner) {
        this.cleanups.push(cleaner);
    }

    remove(cleaner: Cleaner) {
        const index = this.cleanups.indexOf(cleaner);
        if (index > -1) {
            this.cleanups.splice(index, 1);
        }
    }

    async cleanup() {
        // TODO Determine a way that some cleanups can run in parallel?
        while (true) {
            const c = this.cleanups.pop();
            if (!c) break;
            await c();
        }
    }
}

class UnorderedLifecycleHelper extends BaseLifecycleHelper {
    private cleanups = new Set<Cleaner>();

    push(cleaner: Cleaner) {
        this.cleanups.add(cleaner);
        return () => this.cleanups.delete(cleaner);
    }

    /** Add a cleanup function and return a wrapped version that can be called manually */
    addExposed(cleaner: Cleaner) {
        const wrapped_cleaner = async () => {
            try {
                await cleaner();
            } finally {
                this.pop(wrapped_cleaner)
            }
        }

        this.push(wrapped_cleaner);

        return wrapped_cleaner;
    }

    pop(cleaner: Cleaner) {
        this.cleanups.delete(cleaner);
    }

    remove(cleaner: Cleaner) {
        this.pop(cleaner);
    }

    async cleanup() {
        for (let cl of this.cleanups) {
            try {
                await cl();
            } catch (ex) {
                console.error("Disposer failed:", ex);
            }
        }
        this.cleanups.clear();
    }
}

export class LifecycleHelper extends OrderedLifecycleHelper { }
