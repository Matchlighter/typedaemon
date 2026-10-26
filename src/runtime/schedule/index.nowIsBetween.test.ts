import moment from "moment-timezone";
import { nowIsBetween } from "./index";

// Mock the current module to avoid dependencies on hypervisor
jest.mock("../../hypervisor/current", () => ({
  current: {
    hypervisor: {
      currentConfig: {
        location: {
          timezone: "America/New_York",
          latitude: 40.7128,
          longitude: -74.0060,
          elevation: 10,
        },
      },
    },
    application: {
      cleanups: {
        unorderedGroup: jest.fn(() => ({
          addExposed: jest.fn(),
        })),
      },
    },
  },
}));

jest.mock("../../hypervisor/logging", () => ({
  logPluginClientMessage: jest.fn(),
}));

jest.mock("../../plugins/base", () => ({
  bind_callback_env: jest.fn((cb) => cb),
  get_plugin: jest.fn(() => ({
    ha_config: {
      time_zone: "America/New_York",
      latitude: 40.7128,
      longitude: -74.0060,
      elevation: 10,
    },
  })),
}));

describe("nowIsBetween", () => {
  const tz = "America/New_York";
  // 10:00Z == 05:00 EST
  const at = (iso: string) => jest.setSystemTime(new Date(iso));

  beforeEach(() => {
    jest.useFakeTimers();
    at("2025-11-18T10:00:00Z");
  });
  afterEach(() => jest.useRealTimers());

  it("true inside a same-day range", () => {
    expect(nowIsBetween("04:00", "06:00", { timezone: tz })).toBe(true);
  });

  it("false outside a same-day range", () => {
    expect(nowIsBetween("06:00", "08:00", { timezone: tz })).toBe(false);
  });

  it("start inclusive, end exclusive", () => {
    expect(nowIsBetween("05:00", "06:00", { timezone: tz })).toBe(true);
    expect(nowIsBetween("04:00", "05:00", { timezone: tz })).toBe(false);
  });

  it("supports 12-hour times", () => {
    expect(nowIsBetween("4:00 AM", "6:00 AM", { timezone: tz })).toBe(true);
  });

  it("wraps past midnight (late side)", () => {
    at("2025-11-19T03:30:00Z"); // 22:30 EST
    expect(nowIsBetween("22:00", "06:00", { timezone: tz })).toBe(true);
  });

  it("wraps past midnight (early side)", () => {
    expect(nowIsBetween("22:00", "06:00", { timezone: tz })).toBe(true); // 05:00
  });

  it("wrapped range false in the gap", () => {
    at("2025-11-18T17:00:00Z"); // 12:00 EST
    expect(nowIsBetween("22:00", "06:00", { timezone: tz })).toBe(false);
  });

  it("honors timezone", () => {
    expect(nowIsBetween("04:00", "06:00", { timezone: "UTC" })).toBe(false); // 10:00 UTC
    expect(nowIsBetween("09:00", "11:00", { timezone: "UTC" })).toBe(true);
  });

  it("supports sun-relative bounds", () => {
    // NYC Nov: sunrise ~06:50 EST, sunset ~16:45 EST
    at("2025-11-18T17:00:00Z"); // 12:00 EST
    expect(nowIsBetween("sunrise", "sunset", { timezone: tz })).toBe(true);
    at("2025-11-19T03:00:00Z"); // 22:00 EST
    expect(nowIsBetween("sunrise", "sunset", { timezone: tz })).toBe(false);
    expect(nowIsBetween("sunset", "sunrise", { timezone: tz })).toBe(true);
  });
});
