
type Cleaner = () => void;

export class LifecycleHelper {
    private cleanups: Cleaner[] = [];

    // TODO Add Priority queue type stuff?

    append(cleaner: Cleaner) {
        this.cleanups.push(cleaner);
    }

    prepend(cleaner: Cleaner) {
        this.cleanups.unshift(cleaner);
    }

    async cleanup() {
        // TODO Determine a way that some cleanups can run in parallel
        while (true) {
            const c = this.cleanups.pop();
            if (!c) break;
            await c();
        }
    }
}
