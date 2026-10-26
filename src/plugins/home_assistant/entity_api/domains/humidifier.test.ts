import { BASE, discovered, lastState } from "../../../../../test/helpers/entity_api";
import { TDHumidifier } from "./humidifier";

describe("TDHumidifier", () => {
    it("discovers on/off + target humidity topics", async () => {
        const { dd, subscriptions } = await discovered(new TDHumidifier("uuid:ent1"));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            state_topic: `${BASE}/stat`,
            state_value_template: "{{ value_json.state }}",
            target_humidity_command_topic: `${BASE}/cmd/target_humidity_command`,
            target_humidity_state_topic: `${BASE}/stat`,
            target_humidity_state_template: "{{ value_json.target_humidity }}",
        });
        expect(dd.value_template).toBeUndefined();
        for (const k of ["mode", "current_humidity", "action", "min_humidity", "max_humidity", "device_class"]) {
            expect(Object.keys(dd).filter(d => d.startsWith(k))).toEqual([]);
        }
        expect(Object.keys(subscriptions).sort()).toEqual([`${BASE}/cmd`, `${BASE}/cmd/target_humidity_command`]);
    });

    it("passes device_class and humidity range", async () => {
        const { dd } = await discovered(new TDHumidifier("uuid:ent1", { device_class: "dehumidifier", min_humidity: 30, max_humidity: 80 }));
        expect(dd).toMatchObject({ device_class: "dehumidifier", min_humidity: 30, max_humidity: 80 });
    });

    it("routes ON/OFF to handlers, else applies optimistically", async () => {
        const e = new TDHumidifier("uuid:ent1");
        const { send, published } = await discovered(e);
        send("command", "ON");
        expect(lastState(published)).toMatchObject({ state: "ON" });
        send("command", "OFF");
        expect(lastState(published)).toMatchObject({ state: "OFF" });
        e.on_turn_on = jest.fn(); e.on_turn_off = jest.fn();
        send("command", "ON");
        send("command", "OFF");
        send("command", "bogus");
        expect(e.on_turn_on).toHaveBeenCalledTimes(1);
        expect(e.on_turn_off).toHaveBeenCalledTimes(1);
        expect(e.state).toBe(false);
    });

    it("target humidity: handler, else optimistic; rejects NaN and out-of-range", async () => {
        const e = new TDHumidifier("uuid:ent1", { min_humidity: 30, max_humidity: 80 });
        const { send, published } = await discovered(e);
        send("target_humidity_command", "55");
        expect(lastState(published)).toMatchObject({ target_humidity: 55 });
        send("target_humidity_command", "x");
        send("target_humidity_command", "90");
        send("target_humidity_command", "10");
        expect(e.target_humidity).toBe(55);
        e.on_set_target_humidity = jest.fn();
        send("target_humidity_command", "60");
        expect(e.on_set_target_humidity).toHaveBeenCalledWith(60);
        expect(e.target_humidity).toBe(55);
    });

    describe("modes", () => {
        it("discovers topics and modes", async () => {
            const { dd, subscriptions } = await discovered(new TDHumidifier("uuid:ent1", { modes: ["auto", "sleep"] }));
            expect(dd).toMatchObject({
                modes: ["auto", "sleep"],
                mode_command_topic: `${BASE}/cmd/mode_command`,
                mode_state_topic: `${BASE}/stat`,
                mode_state_template: "{{ value_json.mode }}",
            });
            expect(Object.keys(subscriptions)).toContain(`${BASE}/cmd/mode_command`);
        });

        it("accepts only known modes", async () => {
            const e = new TDHumidifier("uuid:ent1", { modes: ["auto", "sleep"] });
            const { send, published } = await discovered(e);
            send("mode_command", "sleep");
            expect(lastState(published)).toMatchObject({ mode: "sleep" });
            send("mode_command", "nope");
            expect(e.mode).toBe("sleep");
            e.on_set_mode = jest.fn();
            send("mode_command", "auto");
            expect(e.on_set_mode).toHaveBeenCalledWith("auto");
            expect(e.mode).toBe("sleep");
        });
    });

    it("publishes current_humidity and action when enabled", async () => {
        const e = new TDHumidifier("uuid:ent1", { current_humidity: true, action: true });
        const { dd, published } = await discovered(e);
        expect(dd).toMatchObject({
            current_humidity_topic: `${BASE}/stat`,
            current_humidity_template: "{{ value_json.current_humidity }}",
            action_topic: `${BASE}/stat`,
            action_template: "{{ value_json.action }}",
        });
        e.current_humidity = 41; e.action = "humidifying";
        await new Promise(r => setTimeout(r, 0));
        expect(lastState(published)).toMatchObject({ current_humidity: 41, action: "humidifying" });
    });
});
