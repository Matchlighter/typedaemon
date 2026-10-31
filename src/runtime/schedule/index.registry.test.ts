import { ScheduleRegistry } from "./registry";

const mockApp = { schedules: undefined as any, cleanups: { unorderedGroup: () => ({ addExposed: (fn: () => void) => fn }) } };
jest.mock("../../hypervisor/current", () => ({
    current: {
        get application() { return mockApp },
        hypervisor: { currentConfig: { location: { timezone: "America/New_York", latitude: 40.7128, longitude: -74.006, elevation: 10 } } },
    },
}));
jest.mock("../../hypervisor/logging", () => ({ logPluginClientMessage: jest.fn() }));
jest.mock("../../plugins/base", () => ({
    bind_callback_env: jest.fn((cb) => cb),
    notePluginAnnotation: jest.fn(),
    handle_client_error: jest.fn(),
    get_plugin: jest.fn(() => ({ ha_config: { time_zone: "America/New_York", latitude: 40.7128, longitude: -74.006, elevation: 10 } })),
}));

import * as baseMock from "../../plugins/base";
import { run_at, run_every, run_in, schedule } from "./index";

const NOW = new Date("2025-11-18T10:00:00Z").getTime();
let registry: ScheduleRegistry;
const only = () => { expect(registry.list()).toHaveLength(1); return registry.list()[0] };

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    registry = mockApp.schedules = new ScheduleRegistry();
});
afterEach(() => { jest.useRealTimers() });

describe("schedules are registered with the app's ScheduleRegistry", () => {
    it("run_every: interval, expression as written, next/last follow the fires", async () => {
        let calls = 0;
        run_every("5m")(function poll() { calls++ });
        expect(only()).toMatchObject({ expression: "run_every('5m')", kind: "interval", method: "poll", nextAt: NOW + 300_000 });
        expect(only().lastAt).toBeUndefined();

        await jest.advanceTimersByTimeAsync(300_000);
        expect(calls).toBe(1);
        expect(only()).toMatchObject({ lastAt: NOW + 300_000, lastResult: "ok", nextAt: NOW + 600_000 });
    });

    it("names the callback after the method, not its binding", () => {
        const holder = { poll() { } };
        run_every("1m")(holder.poll.bind(holder));
        expect(only().method).toBe("poll");
    });

    it("run_in: one-shot, keeps its last result once fired", async () => {
        run_in("10s")(function later() { });
        expect(only()).toMatchObject({ expression: "run_in('10s')", kind: "at", method: "later", nextAt: NOW + 10_000 });
        await jest.advanceTimersByTimeAsync(10_000);
        const row = only();
        expect(row).toMatchObject({ lastAt: NOW + 10_000, lastResult: "ok" });
        expect(row.nextAt).toBeUndefined();
    });

    it("run_at: one-shot at the time as written", () => {
        run_at("4:23 PM", { timezone: "America/New_York" })(function evening() { });
        expect(only()).toMatchObject({ expression: "4:23 PM", kind: "at", method: "evening" });
        expect(only().nextAt).toBeGreaterThan(NOW);
    });

    it("schedule(): cron, time-of-day format, sun-relative and a Date", () => {
        schedule("0 6 * * *")(function a() { });
        schedule("MON-FRI 6:45 AM")(function b() { });
        schedule("sunset-0:30")(function c() { });
        const at = new Date(NOW + 3_600_000);
        schedule(at)(function d() { });
        expect(registry.list().map(s => [s.expression, s.kind, s.method])).toEqual([
            ["0 6 * * *", "cron", "a"],
            ["MON-FRI 6:45 AM", "cron", "b"],
            ["sunset-0:30", "sun", "c"],
            [at.toISOString(), "at", "d"],
        ]);
        expect(registry.list().every(s => s.nextAt! > NOW)).toBe(true);
    });

    it("records a callback that throws as an error, tells the app, and keeps a recurring schedule going", async () => {
        const handled = baseMock.handle_client_error as jest.Mock;
        let calls = 0;
        run_every("1s")(function flaky() { if (calls++ === 0) throw new Error("boom") });
        await jest.advanceTimersByTimeAsync(1_000);
        expect(handled).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
        expect(only()).toMatchObject({ lastResult: "error", lastAt: NOW + 1_000, nextAt: NOW + 2_000 });

        await jest.advanceTimersByTimeAsync(1_000);
        expect(calls).toBe(2);
        expect(only().lastResult).toBe("ok");
    });

    it("an awaited async callback counts as fired when it settles", async () => {
        let finish!: () => void;
        run_in("1s")(() => new Promise<void>(r => { finish = r }));
        await jest.advanceTimersByTimeAsync(1_000);
        expect(only().lastResult).toBeUndefined();
        finish();
        await jest.advanceTimersByTimeAsync(0);
        expect(only().lastResult).toBe("ok");
    });

    it("disposing a schedule removes it", () => {
        const dispose = run_every("5m")(function x() { });
        const dispose2 = run_in("5m")(function y() { });
        expect(registry.list()).toHaveLength(2);
        dispose();
        dispose2();
        expect(registry.list()).toEqual([]);
    });
});
