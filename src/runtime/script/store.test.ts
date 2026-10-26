import "../../../test/helpers/mock_hypervisor";

import { Executor } from "../regen_executor";
import { ScriptStateStore } from "./store";

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

    it("cancelOldest settles the oldest queued run and drops it from the queue", () => {
        const store = new ScriptStateStore({ mode: "restart" });
        const a = makeExecutor();
        const b = makeExecutor();
        const settleA = a.exc.on_completed;
        a.exc.on_completed = (s, v) => { settleA(s, v); store.checkin(a.exc); };
        store.trackPending(a.exc);
        store.trackPending(b.exc);

        store.cancelOldest();

        expect(a.settled).toHaveLength(1);
        expect(a.settled[0].success).toBe(false);
        expect(store.pendingScripts).toEqual([b.exc]);
        expect(b.settled).toHaveLength(0);
    });
});
