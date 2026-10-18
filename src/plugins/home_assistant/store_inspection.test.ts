import { inspect } from "util";

import { HAEntity } from "@matchlighter/ha-mobx-store/model/entity";
import { UpdateFromHAState } from "@matchlighter/ha-mobx-store/model/index";

import "./store_inspection";

function makeEntity() {
    const store = { registries: { huge: "store internals" } } as any;
    const entity = new HAEntity(store);
    entity[UpdateFromHAState]({
        entity_id: "light.kitchen",
        state: "on",
        attributes: { brightness: 128, friendly_name: "Kitchen" },
        last_changed: "2026-01-01T00:00:00Z",
        last_updated: "2026-01-01T00:00:01Z",
        context: { id: "ctx", parent_id: null, user_id: null },
    });
    return entity;
}

describe("HAEntity inspection", () => {
    it("presents the entity as its HA state, without store internals", () => {
        const out = inspect(makeEntity());
        expect(out).toMatch(/^HAEntity \{/);
        expect(out).toContain("entity_id: 'light.kitchen'");
        expect(out).toContain("state: 'on'");
        expect(out).toContain("attributes: { brightness: 128, friendly_name: 'Kitchen' }");
        expect(out).not.toContain("store internals");
        expect(out).not.toContain("Getter/Setter");
    });

    it("collapses when nested beyond the inspection depth", () => {
        expect(inspect({ a: { b: makeEntity() } }, { depth: 1 })).toContain("[HAEntity light.kitchen]");
    });
});
