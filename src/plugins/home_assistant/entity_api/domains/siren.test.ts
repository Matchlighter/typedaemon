jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDSiren } from "./siren";

const BASE = "td/apps/app1/entities/ent1";

function setup(e: TDSiren) {
    const subscriptions: Record<string, any> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (e as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    return { subscriptions, published };
}

async function discovered(e: TDSiren) {
    const ctx = setup(e);
    await (e as any)._register_in_ha();
    const cfg = ctx.published.find(p => p.topic == "homeassistant/siren/ent1/config")!;
    return { ...ctx, dd: JSON.parse(cfg.payload) };
}

const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

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
