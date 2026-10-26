import "../../test/helpers/mock_hypervisor";

import { observable } from "mobx";

import { current } from "../hypervisor/current";
import { when, WHEN_DEFAULT_RESUME_MAX } from "./when";

const WHENS_KEY = "td:whens";
const NOW = 1_700_000_000_000;

/** Fake app: in-memory persistedStorage (as `objectSet`/`getValue` see it) and pass-through invoke/cleanups */
function makeApp(initial: Record<string, any> = {}) {
    const store: Record<string, any> = { [WHENS_KEY]: { ...initial } };
    const app = {
        invoke: (f: Function, ...args: any[]) => f(...args),
        cleanups: { unorderedGroup: () => ({ addExposed: (f: any) => f }) },
        persistedStorage: {
            getValue: (k: string) => store[k],
            objectSet: (k: string, sub: string, value: any) => {
                if (value === undefined) delete store[k][sub];
                else store[k][sub] = value;
            },
        },
    };
    return { app, whens: store[WHENS_KEY] };
}

describe("when resume", () => {
    const saved = (agoSeconds: number) => ({ active_timestamp: NOW - agoSeconds * 1000, last_timestamp: NOW - agoSeconds * 1000, count: 0 });

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        jest.spyOn(console, "warn").mockImplementation(() => { });
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete (current as any).application;
    });

    /** Connect a resumable when over a flag that is already true; returns the callback mock and disposer */
    function connect(initial: Record<string, any>, resume: any) {
        const { app, whens } = makeApp(initial);
        (current as any).application = app;
        const flag = observable({ on: true });
        const cb = jest.fn();
        const dispose = when(() => flag.on, { for: 30, resume })(cb) as () => void;
        return { cb, dispose, whens, flag };
    }

    it("resumes fresh state (timer fires from the saved timestamp)", () => {
        const { cb, dispose } = connect({ w: saved(60 * 60) }, { id: "w", max: 24 * 60 * 60 });
        jest.advanceTimersByTime(1);
        expect(cb).toHaveBeenCalledTimes(1);
        dispose();
    });

    it("drops state older than an explicit max", () => {
        const { cb, whens, dispose } = connect({ w: saved(120) }, { id: "w", max: 60 });
        jest.advanceTimersByTime(1);
        // stale state discarded
        expect(cb).not.toHaveBeenCalled();
        expect(whens.w).toBeUndefined();
        dispose();
    });

    it("applies the default max when resume has no max", () => {
        const r = { id: "w" };
        const stale = connect({ w: saved(WHEN_DEFAULT_RESUME_MAX + 60) }, r);
        jest.advanceTimersByTime(1);
        expect(stale.cb).not.toHaveBeenCalled();
        stale.dispose();

        const fresh = connect({ w: saved(WHEN_DEFAULT_RESUME_MAX - 60) }, r);
        jest.advanceTimersByTime(1);
        expect(fresh.cb).toHaveBeenCalledTimes(1);
        fresh.dispose();
    });

    it("max: null keeps no limit", () => {
        const { cb, dispose } = connect({ w: saved(WHEN_DEFAULT_RESUME_MAX * 10) }, { id: "w", max: null });
        jest.advanceTimersByTime(1);
        expect(cb).toHaveBeenCalledTimes(1);
        dispose();
    });
});
