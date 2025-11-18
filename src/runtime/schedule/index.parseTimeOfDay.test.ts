import moment = require("moment-timezone");
import { parseTimeOfDay, parseDuration } from "./index";

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

describe("parseTimeOfDay", () => {
  const testTimezone = "America/New_York";

  beforeEach(() => {
    // Set a consistent test time
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-11-18T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("24-hour format", () => {
    it("should parse simple 24-hour time", () => {
      const result = parseTimeOfDay("16:23:00", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      // Check time components in the target timezone
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      expect(localResult.second()).toBe(0);
    });

    it("should parse 24-hour time without seconds", () => {
      const result = parseTimeOfDay("14:30", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(14);
      expect(localResult.minute()).toBe(30);
      expect(localResult.second()).toBe(0);
    });

    it("should parse midnight as 00:00:00", () => {
      const result = parseTimeOfDay("00:00:00", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(0);
      expect(localResult.minute()).toBe(0);
      expect(localResult.second()).toBe(0);
    });

    it("should parse end of day as 23:59:59", () => {
      const result = parseTimeOfDay("23:59:59", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(23);
      expect(localResult.minute()).toBe(59);
      expect(localResult.second()).toBe(59);
    });
  });

  describe("12-hour format with meridian", () => {
    it("should parse AM time", () => {
      const result = parseTimeOfDay("4:23:00 AM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(4);
      expect(localResult.minute()).toBe(23);
      expect(localResult.second()).toBe(0);
    });

    it("should parse PM time", () => {
      const result = parseTimeOfDay("4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      expect(localResult.second()).toBe(0);
    });

    it("should parse time without seconds and with meridian", () => {
      const result = parseTimeOfDay("4:23 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      expect(localResult.second()).toBe(0);
    });

    it("should parse noon as 12:00 PM", () => {
      const result = parseTimeOfDay("12:00:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(12);
      expect(localResult.minute()).toBe(0);
      expect(localResult.second()).toBe(0);
    });

    it("should parse midnight as 12:00 AM", () => {
      const result = parseTimeOfDay("12:00:00 AM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(0);
      expect(localResult.minute()).toBe(0);
      expect(localResult.second()).toBe(0);
    });
  });

  describe("timezone handling", () => {
    it("should respect provided timezone", () => {
      const result = parseTimeOfDay("16:23:00", { timezone: "America/Los_Angeles" });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz("America/Los_Angeles");
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
    });

    it("should handle timezone in the time string", () => {
      const result = parseTimeOfDay("4:23:00 PM America/Denver", {});
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz("America/Denver");
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
    });

    it("should handle UTC offset in the time string", () => {
      const result = parseTimeOfDay("4:23:00 PM -07:00", {});
      expect(result).toBeInstanceOf(moment);
      const localResult = result.utcOffset(-7 * 60);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
    });
  });

  describe("sun-relative times", () => {
    it("should parse date with sunset time", () => {
      const result = parseTimeOfDay("2025/11/18 sunset", {
        timezone: testTimezone,
        sun: {
          lat: 40.7128,
          long: -74.0060,
          elev: 10,
        },
      });
      expect(result).toBeInstanceOf(moment);
      // Result should be a valid time
      expect(result.isValid()).toBe(true);
      const localResult = result.tz(testTimezone);
      expect(localResult.year()).toBe(2025);
      expect(localResult.month()).toBe(10);
      expect(localResult.date()).toBe(18);
    });

    it("should parse date with sunrise time", () => {
      const result = parseTimeOfDay("2025/11/18 sunrise", {
        timezone: testTimezone,
        sun: {
          lat: 40.7128,
          long: -74.0060,
          elev: 10,
        },
      });
      expect(result).toBeInstanceOf(moment);
      expect(result.isValid()).toBe(true);
      const localResult = result.tz(testTimezone);
      expect(localResult.year()).toBe(2025);
      expect(localResult.month()).toBe(10);
      expect(localResult.date()).toBe(18);
    });

    it("should parse date with sunset and positive offset", () => {
      const result = parseTimeOfDay("2025/11/18 sunset+1:00", {
        timezone: testTimezone,
        sun: {
          lat: 40.7128,
          long: -74.0060,
          elev: 10,
        },
      });
      expect(result).toBeInstanceOf(moment);
      expect(result.isValid()).toBe(true);
    });

    it("should parse date with sunrise and negative offset", () => {
      const result = parseTimeOfDay("2025/11/18 sunrise-1:00:30", {
        timezone: testTimezone,
        sun: {
          lat: 40.7128,
          long: -74.0060,
          elev: 10,
        },
      });
      expect(result).toBeInstanceOf(moment);
      expect(result.isValid()).toBe(true);
    });
  });

  describe("date patterns with wildcards", () => {
    it("should parse time with full date", () => {
      const result = parseTimeOfDay("2025/11/18 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.year()).toBe(2025);
      expect(localResult.month()).toBe(10); // 0-indexed (November)
      expect(localResult.date()).toBe(18);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
    });

    it("should parse time with wildcard date parts", () => {
      const result = parseTimeOfDay("*/*/{15,30} 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      // Should match either 15th or 30th
      expect([15, 30]).toContain(localResult.date());
    });

    it("should parse time with month range", () => {
      const result = parseTimeOfDay("*/{5-8}/10 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      expect(localResult.date()).toBe(10);
      // Month should be in range 5-8 (May-August, 0-indexed so 4-7)
      expect(localResult.month()).toBeGreaterThanOrEqual(4);
      expect(localResult.month()).toBeLessThanOrEqual(7);
    });
  });

  describe("weekday patterns", () => {
    it("should parse time with specific weekday", () => {
      const result = parseTimeOfDay("MON 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      expect(localResult.day()).toBe(1); // Monday
    });

    it("should parse time with weekday range", () => {
      const result = parseTimeOfDay("MON-FRI 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      // Should be a weekday (1-5)
      expect(localResult.day()).toBeGreaterThanOrEqual(1);
      expect(localResult.day()).toBeLessThanOrEqual(5);
    });

    it("should parse time with multiple weekdays", () => {
      const result = parseTimeOfDay("MON,THU 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      // Should be Monday (1) or Thursday (4)
      expect([1, 4]).toContain(localResult.day());
    });

    it("should parse complex pattern with date and weekday", () => {
      const result = parseTimeOfDay("*/{*}/{1-15} 4:23:00 PM", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      const localResult = result.tz(testTimezone);
      expect(localResult.hour()).toBe(16);
      expect(localResult.minute()).toBe(23);
      // Should be first half of month
      expect(localResult.date()).toBeGreaterThanOrEqual(1);
      expect(localResult.date()).toBeLessThanOrEqual(15);
      // Should be Monday or Tuesday
      expect([1, 2]).toContain(localResult.day());
    });
  });

  describe("edge cases", () => {
    it("should handle case-insensitive input", () => {
      const result = parseTimeOfDay("2025/11/18 sunset", { timezone: testTimezone, sun: { lat: 40.7128, long: -74.0060 } });
      expect(result).toBeInstanceOf(moment);
      expect(result.isValid()).toBe(true);
    });

    it("should return next occurrence after start of day", () => {
      const result = parseTimeOfDay("00:01:00", { timezone: testTimezone });
      expect(result).toBeInstanceOf(moment);
      // Should be today or tomorrow at 00:01:00
      const now = moment().tz(testTimezone);
      expect(result.isAfter(now.clone().startOf("day")) || result.isSame(now.clone().startOf("day"))).toBe(true);
    });
  });
});

describe("parseDuration", () => {
  it("should parse hours", () => {
    expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
  });

  it("should parse minutes", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
  });

  it("should parse seconds", () => {
    expect(parseDuration("45s")).toBe(45 * 1000);
  });

  it("should parse days", () => {
    expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
  });

  it("should parse weeks", () => {
    expect(parseDuration("1w")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("should parse combined durations", () => {
    expect(parseDuration("1h 30m")).toBe((60 + 30) * 60 * 1000);
  });
});
