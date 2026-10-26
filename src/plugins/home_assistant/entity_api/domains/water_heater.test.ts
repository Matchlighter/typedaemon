jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDWaterHeater } from "./water_heater";

const BASE = "td/apps/app1/entities/ent1";

async function discovered(e: TDWaterHeater) {
    const subscriptions: Record<string, (topic: string, payload: any) => void> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (e as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    await (e as any)._register_in_ha();
    const cfg = published.find(p => p.topic == "homeassistant/water_heater/ent1/config")!;
    const send = (key: string, payload: any) => {
        const t = `${BASE}/cmd/${key}`;
        subscriptions[t](t, payload);
    };
    return { subscriptions, published, send, dd: JSON.parse(cfg.payload) };
}

const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

describe("TDWaterHeater", () => {
    it("discovers power, mode and temperature topics (no primary command/state topic)", async () => {
        const { dd, subscriptions } = await discovered(new TDWaterHeater("uuid:ent1"));
        expect(dd).toMatchObject({
            power_command_topic: `${BASE}/cmd/power_command`,
            mode_command_topic: `${BASE}/cmd/mode_command`,
            mode_state_topic: `${BASE}/stat`,
            mode_state_template: "{{ value_json.state }}",
            temperature_command_topic: `${BASE}/cmd/temperature_command`,
            temperature_state_topic: `${BASE}/stat`,
            temperature_state_template: "{{ value_json.temperature }}",
        });
        for (const k of ["command_topic", "state_topic", "value_template", "current_temperature_topic", "modes", "min_temp", "max_temp", "precision", "temperature_unit"]) {
            expect(dd[k]).toBeUndefined();
        }
        expect(Object.keys(subscriptions).sort()).toEqual([
            `${BASE}/cmd/mode_command`, `${BASE}/cmd/power_command`, `${BASE}/cmd/temperature_command`,
        ]);
    });

    it("passes options through", async () => {
        const { dd } = await discovered(new TDWaterHeater("uuid:ent1", {
            modes: ["off", "eco"], min_temp: 40, max_temp: 70, precision: 0.5, temperature_unit: "C", payload_on: "1", payload_off: "0",
        }));
        expect(dd).toMatchObject({ modes: ["off", "eco"], min_temp: 40, max_temp: 70, precision: 0.5, temperature_unit: "C", payload_on: "1", payload_off: "0" });
    });

    it("mode: validates against modes (HA defaults if unset); handler else optimistic", async () => {
        const e = new TDWaterHeater("uuid:ent1", { modes: ["off", "eco"] });
        const { send, published } = await discovered(e);
        send("mode_command", "eco");
        expect(lastState(published)).toMatchObject({ state: "eco" });
        send("mode_command", "gas");
        expect(e.state).toBe("eco");
        e.on_set_mode = jest.fn();
        send("mode_command", "off");
        expect(e.on_set_mode).toHaveBeenCalledWith("off");
        expect(e.state).toBe("eco");

        const d = new TDWaterHeater("uuid:ent2");
        const r = await discovered(d);
        r.send("mode_command", "heat_pump");
        expect(d.state).toBe("heat_pump");
        r.send("mode_command", "bogus");
        expect(d.state).toBe("heat_pump");
    });

    it("temperature: handler, else optimistic; rejects NaN and out-of-range", async () => {
        const e = new TDWaterHeater("uuid:ent1", { min_temp: 40, max_temp: 70 });
        const { send, published } = await discovered(e);
        send("temperature_command", "55.5");
        expect(lastState(published)).toMatchObject({ temperature: 55.5 });
        send("temperature_command", "x");
        send("temperature_command", "80");
        send("temperature_command", "10");
        expect(e.target_temperature).toBe(55.5);
        e.on_set_temperature = jest.fn();
        send("temperature_command", "60");
        expect(e.on_set_temperature).toHaveBeenCalledWith(60);
        expect(e.target_temperature).toBe(55.5);
    });

    it("power: routes payload_on/off to handlers only (no optimistic state)", async () => {
        const e = new TDWaterHeater("uuid:ent1", { payload_on: "1", payload_off: "0" });
        const { send } = await discovered(e);
        e.on_turn_on = jest.fn(); e.on_turn_off = jest.fn();
        send("power_command", "1");
        send("power_command", "0");
        send("power_command", "ON");
        expect(e.on_turn_on).toHaveBeenCalledTimes(1);
        expect(e.on_turn_off).toHaveBeenCalledTimes(1);
        expect(e.state).toBeUndefined();
    });

    it("publishes current_temperature when enabled", async () => {
        const e = new TDWaterHeater("uuid:ent1", { current_temperature: true });
        const { dd, published } = await discovered(e);
        expect(dd).toMatchObject({
            current_temperature_topic: `${BASE}/stat`,
            current_temperature_template: "{{ value_json.current_temperature }}",
        });
        e.current_temperature = 48;
        await new Promise(r => setTimeout(r, 0));
        expect(lastState(published)).toMatchObject({ current_temperature: 48 });
    });
});
