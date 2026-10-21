import { matchEventData } from "./event_filter";

describe("matchEventData", () => {
    const data = { device_id: "abc", command: "on", args: [1] };

    it("matches when no filter is given", () => {
        expect(matchEventData(undefined, data)).toBe(true);
        expect(matchEventData({}, data)).toBe(true);
    });

    it("matches when all filter keys are equal", () => {
        expect(matchEventData({ device_id: "abc" }, data)).toBe(true);
        expect(matchEventData({ device_id: "abc", command: "on" }, data)).toBe(true);
    });

    it("rejects when any filter key differs or is missing", () => {
        expect(matchEventData({ device_id: "abc", command: "off" }, data)).toBe(false);
        expect(matchEventData({ unique_id: "abc" }, data)).toBe(false);
        expect(matchEventData({ device_id: "abc" }, undefined)).toBe(false);
    });
});
