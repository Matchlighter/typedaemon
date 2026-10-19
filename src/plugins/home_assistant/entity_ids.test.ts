import { collectEntities, generateEntityTypes } from "./entity_ids";

const plugin = {
    state: {
        "sensor.humidity": { entity_id: "sensor.humidity" },
        "light.kitchen": { entity_id: "light.kitchen" },
        "sensor.yaml_only": { entity_id: "sensor.yaml_only" },
    },
    entities: {
        "sensor.humidity": { entity_id: "sensor.humidity", name: null, original_name: "Humidity", label_ids: ["climate"] },
        "light.kitchen": { entity_id: "light.kitchen", name: "Kitchen */ Light", label_ids: [] },
    },
    labels: {
        "climate": { label_id: "climate", name: "Climate Stuff" },
    },
} as any;

describe("collectEntities", () => {
    it("includes every entity, sorted, named from the registry", () => {
        expect(collectEntities(plugin, {})).toEqual([
            { entity_id: "light.kitchen", name: "Kitchen */ Light" },
            { entity_id: "sensor.humidity", name: "Humidity" },
            { entity_id: "sensor.yaml_only", name: undefined },
        ]);
    });

    it("filters by label ID or name", () => {
        const expected = [{ entity_id: "sensor.humidity", name: "Humidity" }];
        expect(collectEntities(plugin, { labels: ["climate"] })).toEqual(expected);
        expect(collectEntities(plugin, { labels: ["Climate Stuff"] })).toEqual(expected);
        expect(collectEntities(plugin, { labels: ["nope"] })).toEqual([]);
    });
});

describe("generateEntityTypes", () => {
    it("augments HassEntityIdRegistry, documenting names", () => {
        const out = generateEntityTypes(collectEntities(plugin, {}));
        expect(out).toContain(`declare module "@td" {`);
        expect(out).toContain(`/** Kitchen *\\/ Light */\n        "light.kitchen": true;`);
        expect(out).toContain(`"sensor.yaml_only": true;`);
    });
});
