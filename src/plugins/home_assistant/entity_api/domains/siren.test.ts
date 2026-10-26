import { BASE, discovered, lastState } from "../../../../../test/helpers/entity_api";
import { TDSiren } from "./siren";

describe("TDSiren", () => {
    it("discovers with siren options and state_value_template", async () => {
        const { dd } = await discovered(new TDSiren("uuid:ent1", {
            available_tones: ["bell", "siren"], support_duration: false, support_volume_set: true,
        }));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            state_topic: `${BASE}/stat`,
            state_value_template: "{{ value_json.state }}",
            available_tones: ["bell", "siren"],
            support_duration: false,
            support_volume_set: true,
        });
        expect(dd.value_template).toBeUndefined();
    });

    it("handles plain ON/OFF command payloads", async () => {
        const e = new TDSiren("uuid:ent1");
        const { published, subscriptions } = await discovered(e);
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "ON");
        expect(lastState(published).state).toBe("ON");
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "OFF");
        expect(lastState(published).state).toBe("OFF");
    });

    it("handles HA's default JSON command, exposing tone/duration/volume_level", async () => {
        const e = new TDSiren("uuid:ent1");
        const { published, subscriptions } = await discovered(e);
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, JSON.stringify({ state: "ON", tone: "bell", duration: 10, volume_level: 0.5 }));
        expect(e.state).toBe(true);
        expect(lastState(published)).toMatchObject({ state: "ON", attrs: { tone: "bell", duration: 10, volume_level: 0.5 } });
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, JSON.stringify({ state: "OFF" }));
        expect(e.state).toBe(false);
    });

    it("ignores unrecognised command payloads", async () => {
        const e = new TDSiren("uuid:ent1");
        const { subscriptions } = await discovered(e);
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "nonsense");
        expect(e.state).toBeUndefined();
    });
});
