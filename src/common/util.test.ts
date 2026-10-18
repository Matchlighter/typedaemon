import * as vm from "vm";

import { has_default_to_string } from "./util";

describe("has_default_to_string", () => {
    it("detects objects that would stringify to [object Tag]", () => {
        class Plain { }
        expect(has_default_to_string({})).toBe(true);
        expect(has_default_to_string(new Plain())).toBe(true);
        expect(has_default_to_string(new (vm.runInNewContext("(class Foreign { })"))())).toBe(true);
    });

    it("rejects objects with a meaningful toString", () => {
        class Named { toString() { return "named" } }
        expect(has_default_to_string(new Named())).toBe(false);
        expect(has_default_to_string(new Date())).toBe(false);
        expect(has_default_to_string([1, 2])).toBe(false);
    });
});
