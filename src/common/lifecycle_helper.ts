
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

    pop(cleaner: Cleaner) {
        this.cleanups.delete(cleaner);
    }

    async cleanup() {
        for (let cl of this.cleanups) {
            await cl();
        }
        this.cleanups.clear();
    }
}

export class LifecycleHelper extends OrderedLifecycleHelper { }
