import "../../../test/helpers/mock_hypervisor";

import { current } from "../../hypervisor/current";
import { run_every, run_in } from "./index";

const logClientMessage = jest.fn();

beforeEach(() => {
    jest.useFakeTimers();
    logClientMessage.mockClear();
    (current as any).application = {
        cleanups: { unorderedGroup: () => ({ addExposed: (f: () => void) => f }) },
        logClientMessage,
        schedules: { add: () => ({ armed() { }, fired() { }, remove() { } }) },
        invoke: (f: () => any) => f(),
    };
});

afterEach(() => {
    jest.useRealTimers();
    delete (current as any).application;
});

describe("a throwing schedule callback", () => {
    it("is logged for the app", async () => {
        const boom = new Error("boom");
        run_in("1s")(() => { throw boom });
        await jest.advanceTimersByTimeAsync(1100);
        expect(logClientMessage).toHaveBeenCalledWith("error", boom);
    });

    it("does not end a recurring schedule", async () => {
        const cb = jest.fn(() => { throw new Error("boom") });
        const dispose = run_every("1s")(cb);
        await jest.advanceTimersByTimeAsync(3500);
        expect(cb).toHaveBeenCalledTimes(3);
        dispose();
    });
});
