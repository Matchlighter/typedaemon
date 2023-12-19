
export class Batcher {
    constructor(private readonly close_batch: () => void) {

    }

    private batch_depth = 0;

    perform(f: () => void) {
        this.batch_depth += 1;
        try {
            f();
        } finally {
            this.batch_depth -= 1;
        }
        if (this.batch_depth == 0) {
            this.close_batch();
        }
    }
}
