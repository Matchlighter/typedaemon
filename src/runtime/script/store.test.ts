import "../../../test/helpers/mock_hypervisor";

import { Executor } from "../regen_executor";

function makeExecutor() {
    const exc = new Executor((ctx) => { ctx.next = "end"; return ctx.stop(); }, { self: {}, try_locs: [], marked_locs: [] });
    const settled: { success: boolean, value: any }[] = [];
    exc.on_completed = (success, value) => { settled.push({ success, value }); };
    return { exc, settled };
}

describe("cancelling an unstarted (queued) executor", () => {
    it("settles with the cancel reason and never runs", () => {
        const { exc, settled } = makeExecutor();
        const reason = new Error("nope");
        exc.cancel(reason);
        expect(settled).toEqual([{ success: false, value: reason }]);
        expect(exc._started).toBe(false);
    });
});
