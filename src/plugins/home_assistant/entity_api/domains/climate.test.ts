jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDClimate } from "./climate";

const BASE = "td/apps/app1/entities/ent1";

async function discovered(e: TDClimate) {
    const subscriptions: Record<string, (topic: string, payload: any) => void> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (e as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    await (e as any)._register_in_ha();
    const cfg = published.find(p => p.topic == "homeassistant/climate/ent1/config")!;
    const send = (key: string, payload: any) => {
        const t = key == "command" ? `${BASE}/cmd` : `${BASE}/cmd/${key}`;
        subscriptions[t](t, payload);
    };
    return { subscriptions, published, send, dd: JSON.parse(cfg.payload) };
}



const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

describe("TDClimate", () => {
    it("discovers minimal: mode, power and temperature topics only", async () => {
        const { dd, subscriptions } = await discovered(new TDClimate("uuid:ent1"));
        expect(dd).toMatchObject({
            mode_command_topic: `${BASE}/cmd/mode_command`,
            mode_state_topic: `${BASE}/stat`,
            mode_state_template: "{{ value_json.state }}",
            power_command_topic: `${BASE}/cmd/power_command`,
            temperature_command_topic: `${BASE}/cmd/temperature_command`,
            temperature_state_topic: `${BASE}/stat`,
            temperature_state_template: "{{ value_json.temperature }}",
        });
        for (const k of ["command_topic", "state_topic", "value_template", "temperature_high_command_topic", "fan_mode_command_topic", "swing_mode_command_topic", "preset_mode_command_topic", "action_topic", "current_temperature_topic", "current_humidity_topic", "target_humidity_command_topic"]) {
            expect(dd[k]).toBeUndefined();
        }
        expect(Object.keys(subscriptions).sort()).toEqual(["mode_command", "power_command", "temperature_command"].map(k => `${BASE}/cmd/${k}`));
    });

    it("passes through scalar options", async () => {
        const { dd } = await discovered(new TDClimate("uuid:ent1", { modes: ["off", "heat"], min_temp: 10, max_temp: 30, precision: 0.5, temp_step: 0.5, temperature_unit: "C", payload_on: "1", payload_off: "0" }));
        expect(dd).toMatchObject({ modes: ["off", "heat"], min_temp: 10, max_temp: 30, precision: 0.5, temp_step: 0.5, temperature_unit: "C", payload_on: "1", payload_off: "0" });
    });

    it("optional features add topics, templates, lists and subscriptions", async () => {
        const { dd, subscriptions } = await discovered(new TDClimate("uuid:ent1", {
            high_low: true, current_temperature: true, current_humidity: true, target_humidity: true, min_humidity: 20, max_humidity: 80,
            fan_modes: ["auto", "low"], swing_modes: ["on", "off"], preset_modes: ["eco"], action: true,
        }));
        expect(dd).toMatchObject({
            temperature_high_command_topic: `${BASE}/cmd/temperature_high_command`,
            temperature_high_state_topic: `${BASE}/stat`,
            temperature_high_state_template: "{{ value_json.temperature_high }}",
            temperature_low_command_topic: `${BASE}/cmd/temperature_low_command`,
            temperature_low_state_template: "{{ value_json.temperature_low }}",
            current_temperature_topic: `${BASE}/stat`,
            current_temperature_template: "{{ value_json.current_temperature }}",
            current_humidity_topic: `${BASE}/stat`,
            current_humidity_template: "{{ value_json.current_humidity }}",
            target_humidity_command_topic: `${BASE}/cmd/target_humidity_command`,
            target_humidity_state_template: "{{ value_json.target_humidity }}",
            min_humidity: 20, max_humidity: 80,
            fan_modes: ["auto", "low"],
            fan_mode_command_topic: `${BASE}/cmd/fan_mode_command`,
            fan_mode_state_template: "{{ value_json.fan_mode }}",
            swing_modes: ["on", "off"],
            swing_mode_command_topic: `${BASE}/cmd/swing_mode_command`,
            swing_mode_state_template: "{{ value_json.swing_mode }}",
            preset_modes: ["eco"],
            preset_mode_command_topic: `${BASE}/cmd/preset_mode_command`,
            preset_mode_state_topic: `${BASE}/stat`,
            preset_mode_value_template: "{{ value_json.preset_mode }}",
            action_topic: `${BASE}/stat`,
            action_template: "{{ value_json.action }}",
        });
        expect(Object.keys(subscriptions).length).toBe(9);
    });

    it("min/max_humidity only emitted with target_humidity", async () => {
        const { dd } = await discovered(new TDClimate("uuid:ent1", { min_humidity: 20 }));
        expect(dd.min_humidity).toBeUndefined();
    });

    it("mode: validates against modes, handler else optimistic", async () => {
        const e = new TDClimate("uuid:ent1", { modes: ["off", "heat"] });
        const { send, published } = await discovered(e);
        send("mode_command", "cool");
        expect(e.state).toBeUndefined();
        send("mode_command", "heat");
        expect(lastState(published)).toMatchObject({ state: "heat" });
        e.on_set_mode = jest.fn();
        send("mode_command", "off");
        expect(e.on_set_mode).toHaveBeenCalledWith("off");
        expect(e.state).toBe("heat");
    });

    it("power: payloads route to handlers, never optimistic", async () => {
        const e = new TDClimate("uuid:ent1", { payload_on: "1" });
        const { send } = await discovered(e);
        e.on_turn_on = jest.fn(); e.on_turn_off = jest.fn();
        send("power_command", "ON");
        expect(e.on_turn_on).not.toHaveBeenCalled();
        send("power_command", "1");
        send("power_command", "OFF");
        expect(e.on_turn_on).toHaveBeenCalledTimes(1);
        expect(e.on_turn_off).toHaveBeenCalledTimes(1);
        expect(e.state).toBeUndefined();
    });

    it("temperatures: parse, range-check, handler else optimistic", async () => {
        const e = new TDClimate("uuid:ent1", { high_low: true, min_temp: 10, max_temp: 30 });
        const { send, published } = await discovered(e);
        send("temperature_command", "abc");
        send("temperature_command", "31");
        expect(e.target_temperature).toBeUndefined();
        send("temperature_command", "21.5");
        send("temperature_high_command", "25");
        send("temperature_low_command", "18");
        expect(lastState(published)).toMatchObject({ temperature: 21.5, temperature_high: 25, temperature_low: 18 });
        e.on_set_temperature = jest.fn(); e.on_set_temperature_range = jest.fn();
        send("temperature_command", "22");
        expect(e.on_set_temperature).toHaveBeenCalledWith(22);
        send("temperature_high_command", "26");
        expect(e.on_set_temperature_range).toHaveBeenCalledWith({ high: 26 });
        send("temperature_low_command", "19");
        expect(e.on_set_temperature_range).toHaveBeenCalledWith({ low: 19 });
        expect(e.target_temperature).toBe(21.5);
        expect(e.target_temperature_high).toBe(25);
    });

    it("target humidity: range-checked, handler else optimistic", async () => {
        const e = new TDClimate("uuid:ent1", { target_humidity: true });
        const { send, published } = await discovered(e);
        send("target_humidity_command", "20");
        expect(e.target_humidity).toBeUndefined();
        send("target_humidity_command", "100");
        expect(e.target_humidity).toBeUndefined();
        send("target_humidity_command", "45");
        expect(lastState(published)).toMatchObject({ target_humidity: 45 });
        e.on_set_humidity = jest.fn();
        send("target_humidity_command", "50");
        expect(e.on_set_humidity).toHaveBeenCalledWith(50);
    });

    it("fan/swing/preset: validated, handler else optimistic", async () => {
        const e = new TDClimate("uuid:ent1", { fan_modes: ["auto", "low"], swing_modes: ["on"], preset_modes: ["eco"] });
        const { send, published } = await discovered(e);
        send("fan_mode_command", "high"); send("swing_mode_command", "off"); send("preset_mode_command", "away");
        expect([e.fan_mode, e.swing_mode, e.preset_mode]).toEqual([undefined, undefined, undefined]);
        send("fan_mode_command", "low"); send("swing_mode_command", "on"); send("preset_mode_command", "eco");
        expect(lastState(published)).toMatchObject({ fan_mode: "low", swing_mode: "on", preset_mode: "eco" });
        e.on_set_fan_mode = jest.fn(); e.on_set_swing_mode = jest.fn(); e.on_set_preset_mode = jest.fn();
        send("fan_mode_command", "auto"); send("swing_mode_command", "on"); send("preset_mode_command", "eco");
        expect(e.on_set_fan_mode).toHaveBeenCalledWith("auto");
        expect(e.on_set_swing_mode).toHaveBeenCalledWith("on");
        expect(e.on_set_preset_mode).toHaveBeenCalledWith("eco");
        expect(e.fan_mode).toBe("low");
    });

    it("publishes current temp/humidity/action only when enabled", async () => {
        const e = new TDClimate("uuid:ent1", { current_temperature: true, action: true });
        const { published } = await discovered(e);
        e.current_temperature = 20; e.action = "heating"; e.current_humidity = 40;
        const s = lastState(published);
        expect(s).toMatchObject({ current_temperature: 20, action: "heating" });
        expect(s.current_humidity).toBeUndefined();
    });
});
