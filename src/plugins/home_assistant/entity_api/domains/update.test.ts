jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDUpdate } from "./update";

const BASE = "td/apps/app1/entities/ent1";

function setup(e: TDUpdate) {
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

async function discovered(e: TDUpdate) {
    const ctx = setup(e);
    await (e as any)._register_in_ha();
    const cfg = ctx.published.find(p => p.topic == "homeassistant/update/ent1/config")!;
    return { ...ctx, dd: JSON.parse(cfg.payload) };
}

const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

describe("TDUpdate", () => {
    it("discovers with update options, command topic and payload_install", async () => {
        const { dd } = await discovered(new TDUpdate("uuid:ent1", {
            device_class: "firmware", title: "Fw", release_summary: "sum", release_url: "http://x", entity_picture: "http://p", display_precision: 1,
        }));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            payload_install: "INSTALL",
            state_topic: `${BASE}/stat`,
            device_class: "firmware", title: "Fw", release_summary: "sum", release_url: "http://x",
            entity_picture: "http://p", display_precision: 1,
        });
        expect(dd.value_template).toBeUndefined();
    });

    it("omits command_topic when no install handler is wanted", async () => {
        const { dd } = await discovered(new TDUpdate("uuid:ent1", { installable: false }));
        expect(dd.command_topic).toBeUndefined();
        expect(dd.payload_install).toBeUndefined();
    });

    it("publishes update info as top-level JSON fields", async () => {
        const e = new TDUpdate("uuid:ent1");
        const { published } = await discovered(e);
        e.setInfo({ installed_version: "1.0", latest_version: "1.1", in_progress: true, update_percentage: 40, title: "T" });
        expect(lastState(published)).toMatchObject({
            installed_version: "1.0", latest_version: "1.1", in_progress: true, update_percentage: 40, title: "T",
        });
        expect(e.state).toBe("1.0");
    });

    it("calls on_install for the install payload only", async () => {
        const e = new TDUpdate("uuid:ent1");
        const { subscriptions } = await discovered(e);
        const fn = jest.fn();
        e.on_install = fn;
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "nonsense");
        expect(fn).not.toHaveBeenCalled();
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "INSTALL");
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
