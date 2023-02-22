
type Cleaner = () => void;

export class LifecycleHelper {
    private cleanups: Cleaner[] = [];

    mark(cleaner: Cleaner) {
        this.cleanups.push(cleaner);
    }

    cleanup() {
        for (let c of [...this.cleanups].reverse()) {
            c();
        }
    }
}
