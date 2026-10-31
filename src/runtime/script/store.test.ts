import "../../../test/helpers/mock_hypervisor";

import { Executor } from "../regen_executor";
import { scriptLimit, ScriptStateStore } from "./store";

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

describe("ScriptStateStore restart limit", () => {
    const item = (): any => ({ cancel: jest.fn(), start: jest.fn() });

    it("defaults to 1: makeRoom cancels running and queued runs and frees the slot", () => {
        const store = new ScriptStateStore({ mode: "restart" });
        const [a, b, c] = [item(), item(), item()];
        store.trackPending(a); store.refill();
        store.trackPending(b);
        const reason = new Error("again");
        store.makeRoom(reason);
        expect(a.cancel).toHaveBeenCalledWith(reason);
        expect(b.cancel).toHaveBeenCalledWith(reason);
        expect(store.total_count).toBe(0);
        store.trackPending(c); store.refill();
        expect(c.start).toHaveBeenCalled();
    });

    it("limit N keeps the N-1 newest and runs N at once", () => {
        const store = new ScriptStateStore({ mode: "restart", limit: 2 });
        const [a, b, c] = [item(), item(), item()];
        store.trackPending(a); store.refill();
        store.makeRoom();
        expect(a.cancel).not.toHaveBeenCalled();
        store.trackPending(b); store.refill();
        expect(b.start).toHaveBeenCalled();
        store.makeRoom();
        expect(a.cancel).toHaveBeenCalled();
        expect(b.cancel).not.toHaveBeenCalled();
        store.trackPending(c); store.refill();
        expect(c.start).toHaveBeenCalled();
    });

    it("limit false cancels nothing", () => {
        const store = new ScriptStateStore({ mode: "restart", limit: false });
        const a = item();
        store.trackPending(a); store.refill();
        store.makeRoom();
        expect(a.cancel).not.toHaveBeenCalled();
    });
});

describe("ScriptStateStore dashboard hooks", () => {
    it("makeRoom emits change", () => {
        const store = new ScriptStateStore({ mode: "restart" });
        store.trackPending({ cancel: jest.fn(), start: jest.fn() } as any); store.refill();
        const onChange = jest.fn();
        store.on("change", onChange);
        store.makeRoom();
        expect(onChange).toHaveBeenCalled();
    });
});

describe("scriptLimit", () => {
    it("restart defaults to 1 and honors limit", () => {
        expect(scriptLimit({ mode: "restart" })).toBe(1);
        expect(scriptLimit({ mode: "restart", limit: 3 })).toBe(3);
        expect(scriptLimit({ mode: "restart", limit: false })).toBeNull();
    });

    it("keeps the other defaults", () => {
        expect(scriptLimit({ mode: "single" })).toBe(1);
        expect(scriptLimit({ mode: "parallel" })).toBe(20);
        expect(scriptLimit({ mode: "queued", limit: 5 })).toBe(5);
        expect(scriptLimit({ mode: "queued", limit: false })).toBeNull();
    });
});
