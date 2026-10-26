jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});

import { TDTag } from "./tag";

const BASE = "td/apps/app1/entities/ent1";

function setup(tag: TDTag) {
    const subscriptions: Record<string, any> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (tag as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    return { subscriptions, published };
}

describe("TDTag", () => {
    it("discovers on tag domain with only topic, value_template and device", async () => {
        const tag = new TDTag("uuid:ent1", { value_template: "{{ value_json.uid }}" });
        const { published } = setup(tag);
        await (tag as any)._register_in_ha();
        const cfg = published.find(p => p.topic == "homeassistant/tag/ent1/config")!;
        expect(JSON.parse(cfg.payload)).toEqual({
            topic: `${BASE}/stat`,
            value_template: "{{ value_json.uid }}",
            device: { name: "App Device" },
        });
    });

    it("subscribes to no command topics", async () => {
        const tag = new TDTag("uuid:ent1");
        const { subscriptions } = setup(tag);
        await (tag as any)._register_in_ha();
        expect(Object.keys(subscriptions)).toEqual([]);
    });

    it("scan() publishes the raw tag id and state is never published", async () => {
        const tag = new TDTag("uuid:ent1");
        const { published } = setup(tag);
        await (tag as any)._register_in_ha();
        tag.scan("04A1B2");
        const onState = published.filter(p => p.topic == `${BASE}/stat`);
        expect(onState.map(p => p.payload)).toEqual(["04A1B2"]);
    });
});
