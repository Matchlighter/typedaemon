import "../../../../../test/helpers/entity_api";
import { discoveryPassOptions, parseJsonOrRaw, parseNumberPayload, parseOnOff } from "./base";

describe("command payload helpers", () => {
    it("parseNumberPayload parses numbers/strings and enforces optional bounds", () => {
        expect(parseNumberPayload("42.5")).toBe(42.5);
        expect(parseNumberPayload(7)).toBe(7);
        expect(parseNumberPayload("abc")).toBeUndefined();
        expect(parseNumberPayload(5, 0, 10)).toBe(5);
        expect(parseNumberPayload(-1, 0, 10)).toBeUndefined();
        expect(parseNumberPayload(11, 0, 10)).toBeUndefined();
        expect(parseNumberPayload(11, undefined, undefined)).toBe(11);
    });

    it("parseOnOff accepts default and custom payloads", () => {
        expect(parseOnOff("ON")).toBe(true);
        expect(parseOnOff("OFF")).toBe(false);
        expect(parseOnOff("on")).toBeUndefined();
        expect(parseOnOff("1", "1", "0")).toBe(true);
        expect(parseOnOff("ON", undefined, undefined)).toBe(true);
    });

    it("parseJsonOrRaw returns objects, raw strings, or undefined for malformed JSON", () => {
        expect(parseJsonOrRaw({ a: 1 })).toEqual({ a: 1 });
        expect(parseJsonOrRaw('{"a":1}')).toEqual({ a: 1 });
        expect(parseJsonOrRaw("dock")).toBe("dock");
        expect(parseJsonOrRaw(Buffer.from("dock"))).toBe("dock");
        expect(parseJsonOrRaw('{"a":')).toBeUndefined();
        expect(parseJsonOrRaw(null)).toBeUndefined();
    });

    it("discoveryPassOptions skips undefined options", () => {
        expect(discoveryPassOptions<{ a?: number, b?: number }>({ a: 1, b: undefined }, ["a", "b"])).toEqual({ a: 1 });
        expect(Object.keys(discoveryPassOptions<{ a?: number }>(undefined, ["a"]))).toEqual([]);
    });
});
