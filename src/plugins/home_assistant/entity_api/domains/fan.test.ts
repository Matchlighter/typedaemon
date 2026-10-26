jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDFan } from "./fan";

const BASE = "td/apps/app1/entities/ent1";

async function discovered(e: TDFan) {
    const subscriptions: Record<string, (topic: string, payload: any) => void> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (e as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    await (e as any)._register_in_ha();
    const cfg = published.find(p => p.topic == "homeassistant/fan/ent1/config")!;
    const send = (key: string, payload: any) => {
        const t = key == "command" ? `${BASE}/cmd` : `${BASE}/cmd/${key}`;
        subscriptions[t](t, payload);
    };
    return { subscriptions, published, send, dd: JSON.parse(cfg.payload) };
}


const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

describe("TDFan", () => {
    it("discovers a basic on/off fan", async () => {
        const { dd, subscriptions } = await discovered(new TDFan("uuid:ent1"));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            state_topic: `${BASE}/stat`,
            state_value_template: "{{ value_json.state }}",
        });
        for (const k of ["percentage", "preset_mode", "oscillation", "direction"]) {
            expect(Object.keys(dd).filter(d => d.startsWith(k))).toEqual([]);
        }
        expect(Object.keys(subscriptions)).toEqual([`${BASE}/cmd`]);
    });

    it("routes ON/OFF to handlers, else applies optimistically", async () => {
        const e = new TDFan("uuid:ent1");
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

    describe("percentage", () => {
        it("discovers topics and range", async () => {
            const { dd, subscriptions } = await discovered(new TDFan("uuid:ent1", { percentage: true, speed_range_min: 1, speed_range_max: 6 }));
            expect(dd).toMatchObject({
                percentage_command_topic: `${BASE}/cmd/percentage_command`,
                percentage_state_topic: `${BASE}/stat`,
                percentage_value_template: "{{ value_json.percentage }}",
                speed_range_min: 1, speed_range_max: 6,
            });
            expect(Object.keys(subscriptions).sort()).toEqual([`${BASE}/cmd`, `${BASE}/cmd/percentage_command`]);
        });

        it("routes to handler as number, else optimistic (0 turns off, >0 turns on)", async () => {
            const e = new TDFan("uuid:ent1", { percentage: true });
            const { send, published } = await discovered(e);
            send("percentage_command", "40");
            expect(lastState(published)).toMatchObject({ state: "ON", percentage: 40 });
            send("percentage_command", "0");
            expect(lastState(published)).toMatchObject({ state: "OFF", percentage: 0 });
            e.on_set_percentage = jest.fn();
            send("percentage_command", "75");
            send("percentage_command", "x");
            expect(e.on_set_percentage).toHaveBeenCalledTimes(1);
            expect(e.on_set_percentage).toHaveBeenCalledWith(75);
            expect(e.percentage).toBe(0);
        });
    });

    describe("preset modes", () => {
        it("discovers topics and modes", async () => {
            const { dd } = await discovered(new TDFan("uuid:ent1", { preset_modes: ["auto", "eco"] }));
            expect(dd).toMatchObject({
                preset_modes: ["auto", "eco"],
                preset_mode_command_topic: `${BASE}/cmd/preset_mode_command`,
                preset_mode_state_topic: `${BASE}/stat`,
                preset_mode_value_template: "{{ value_json.preset_mode }}",
            });
        });

        it("accepts only known modes", async () => {
            const e = new TDFan("uuid:ent1", { preset_modes: ["auto", "eco"] });
            const { send, published } = await discovered(e);
            send("preset_mode_command", "eco");
            expect(lastState(published)).toMatchObject({ preset_mode: "eco" });
            send("preset_mode_command", "nope");
            expect(e.preset_mode).toBe("eco");
            e.on_set_preset_mode = jest.fn();
            send("preset_mode_command", "auto");
            expect(e.on_set_preset_mode).toHaveBeenCalledWith("auto");
            expect(e.preset_mode).toBe("eco");
        });
    });

    describe("oscillation", () => {
        it("discovers topics with state mapped to payloads", async () => {
            const { dd } = await discovered(new TDFan("uuid:ent1", { oscillation: true }));
            expect(dd).toMatchObject({
                oscillation_command_topic: `${BASE}/cmd/oscillation_command`,
                oscillation_state_topic: `${BASE}/stat`,
                oscillation_value_template: "{{ 'oscillate_on' if value_json.oscillating else 'oscillate_off' }}",
            });
        });

        it("handles oscillate_on/off", async () => {
            const e = new TDFan("uuid:ent1", { oscillation: true });
            const { send, published } = await discovered(e);
            send("oscillation_command", "oscillate_on");
            expect(lastState(published)).toMatchObject({ oscillating: true });
            send("oscillation_command", "oscillate_off");
            expect(lastState(published)).toMatchObject({ oscillating: false });
            e.on_set_oscillating = jest.fn();
            send("oscillation_command", "oscillate_on");
            send("oscillation_command", "bogus");
            expect(e.on_set_oscillating).toHaveBeenCalledTimes(1);
            expect(e.on_set_oscillating).toHaveBeenCalledWith(true);
        });
    });

    describe("direction", () => {
        it("discovers topics", async () => {
            const { dd } = await discovered(new TDFan("uuid:ent1", { direction: true }));
            expect(dd).toMatchObject({
                direction_command_topic: `${BASE}/cmd/direction_command`,
                direction_state_topic: `${BASE}/stat`,
                direction_value_template: "{{ value_json.direction }}",
            });
        });

        it("handles forward/reverse only", async () => {
            const e = new TDFan("uuid:ent1", { direction: true });
            const { send, published } = await discovered(e);
            send("direction_command", "reverse");
            expect(lastState(published)).toMatchObject({ direction: "reverse" });
            send("direction_command", "sideways");
            expect(e.direction).toBe("reverse");
            e.on_set_direction = jest.fn();
            send("direction_command", "forward");
            expect(e.on_set_direction).toHaveBeenCalledWith("forward");
        });
    });
});
