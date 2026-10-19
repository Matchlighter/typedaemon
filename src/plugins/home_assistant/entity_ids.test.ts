// Load modules in the order the real app does (via config -> `@td` index), avoiding a pre-existing circular import
import "../../hypervisor/config";
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

jest.mock("../../common/generate_tsconfig", () => ({ saveGeneratedTypes: jest.fn(async () => { }) }));

describe("syncEntityTypes", () => {
    const { observable, runInAction } = require("mobx");
    const { saveGeneratedTypes } = require("../../common/generate_tsconfig");
    const { HyperWrapper } = require("../../hypervisor/managed_apps");
    const { syncEntityTypes } = require("./entity_ids");

    beforeEach(() => jest.useFakeTimers({ now: 0 }));
    afterEach(() => jest.useRealTimers());

    it("throttles, pauses while churning, and resumes once the rate drops", async () => {
        const state = observable({} as Record<string, any>);
        const instance = { id: "ha", hypervisor: {}, logMessage: jest.fn(), raiseIssue: jest.fn(), clearIssue: jest.fn() };
        const fake = {
            state, entities: {}, labels: {},
            _synced_store: { isInitialized: true },
            callService: jest.fn(async () => { }),
            [HyperWrapper]: instance,
        } as any;
        const services = () => fake.callService.mock.calls.map(c => c[0]);
        const writes = () => saveGeneratedTypes.mock.calls.length;
        const churn = (id: string) => runInAction(() => { state[id] = { entity_id: id, attributes: {} } });

        const dispose = syncEntityTypes(fake, { min_interval: 1000, rate_limit: { count: 2, window: 10_000 } });
        await jest.advanceTimersByTimeAsync(0);
        expect(writes()).toBe(1);

        // Changes within min_interval coalesce into one write
        churn("sensor.a"); churn("sensor.b");
        await jest.advanceTimersByTimeAsync(1000);
        expect(writes()).toBe(2);

        // Third regeneration within the window: paused, flagged and notified
        churn("sensor.c");
        await jest.advanceTimersByTimeAsync(1000);
        expect(writes()).toBe(2);
        expect(instance.raiseIssue).toHaveBeenCalledWith("entity_types", "warn", expect.any(String));
        expect(services()).toContain("persistent_notification.create");

        // Once the rate drops, the latest entities are written and the warning cleared
        await jest.advanceTimersByTimeAsync(10_000);
        expect(writes()).toBe(3);
        expect(saveGeneratedTypes.mock.calls[2][2]).toContain(`"sensor.c": true;`);
        expect(instance.clearIssue).toHaveBeenCalledTimes(2);
        expect(services().at(-1)).toBe("persistent_notification.dismiss");

        dispose();
    });
});
