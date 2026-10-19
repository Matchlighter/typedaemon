import { collectEntities, generateEntityTypes } from "./entity_ids";

const area = { name: "Living Room" };
const plugin = {
    state: {
        "sensor.humidity": { entity_id: "sensor.humidity", attributes: { friendly_name: "LR Humidity", device_class: "humidity", unit_of_measurement: "%" } },
        "light.kitchen": { entity_id: "light.kitchen", attributes: {} },
        "sensor.yaml_only": { entity_id: "sensor.yaml_only", attributes: {} },
    },
    entities: {
        "sensor.humidity": {
            entity_id: "sensor.humidity", name: null, original_name: "Humidity", platform: "zha", label_ids: ["climate"],
            area, device: { name: "Aqara", name_by_user: null }, labels: [{ name: "Climate Stuff" }],
        },
        "light.kitchen": { entity_id: "light.kitchen", name: "Kitchen */ Light", label_ids: [] },
    },
    labels: {
        "climate": { label_id: "climate", name: "Climate Stuff" },
    },
} as any;

describe("collectEntities", () => {
    it("includes every entity, sorted, with docs", () => {
        expect(collectEntities(plugin, {})).toEqual([
            { entity_id: "light.kitchen", docs: ["**Kitchen */ Light**", ""] },
            {
                entity_id: "sensor.humidity", docs: [
                    "**LR Humidity**", "",
                    "- Area: Living Room", "- Device: Aqara", "- Integration: zha", "- Labels: Climate Stuff",
                    "- Device class: humidity", "- Unit: %",
                ],
            },
            { entity_id: "sensor.yaml_only", docs: [] },
        ]);
    });

    it("filters by label ID or name", () => {
        const ids = (labels: string[]) => collectEntities(plugin, { labels }).map(e => e.entity_id);
        expect(ids(["climate"])).toEqual(["sensor.humidity"]);
        expect(ids(["Climate Stuff"])).toEqual(["sensor.humidity"]);
        expect(ids(["nope"])).toEqual([]);
    });
});

describe("generateEntityTypes", () => {
    it("augments HassEntityIdRegistry with JSDoc", () => {
        const out = generateEntityTypes(collectEntities(plugin, {}));
        expect(out).toContain(`declare module "@td" {`);
        expect(out).toContain([
            `        /**`,
            `         * **Kitchen *\\/ Light**`,
            `         *`,
            `         */`,
            `        "light.kitchen": true;`,
        ].join("\n"));
        expect(out).toContain(`        "sensor.yaml_only": true;`);
    });
});
