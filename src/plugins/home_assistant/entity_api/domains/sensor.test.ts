import { discovered } from "../../../../../test/helpers/entity_api";
import { TDSensor } from "./sensor";

describe("TDSensor discovery", () => {
    it("defaults to measurement and omits last_reset_value_template (HA rejects it)", async () => {
        const { dd } = await discovered(new TDSensor("uuid:ent1"));
        expect(dd.state_class).toBe("measurement");
        expect(dd).not.toHaveProperty("last_reset_value_template");
    });

    it("omits last_reset_value_template for explicit measurement and total_increasing", async () => {
        for (const state_class of ["measurement", "total_increasing"] as const) {
            const { dd } = await discovered(new TDSensor("uuid:ent1", { state_class }));
            expect(dd.state_class).toBe(state_class);
            expect(dd).not.toHaveProperty("last_reset_value_template");
        }
    });

    it("keeps last_reset_value_template for total", async () => {
        const { dd } = await discovered(new TDSensor("uuid:ent1", { state_class: "total" }));
        expect(dd.state_class).toBe("total");
        expect(dd.last_reset_value_template).toContain("last_reset");
    });
});
