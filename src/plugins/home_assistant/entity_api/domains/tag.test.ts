import { BASE, bindFakeStore } from "../../../../../test/helpers/entity_api";
import { TDTag } from "./tag";

describe("TDTag", () => {
    it("discovers on tag domain with only topic, value_template and device", async () => {
        const tag = new TDTag("uuid:ent1", { value_template: "{{ value_json.uid }}" });
        const { published } = bindFakeStore(tag);
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
        const { subscriptions } = bindFakeStore(tag);
        await (tag as any)._register_in_ha();
        expect(Object.keys(subscriptions)).toEqual([]);
    });

    it("scan() publishes the raw tag id and state is never published", async () => {
        const tag = new TDTag("uuid:ent1");
        const { published } = bindFakeStore(tag);
        await (tag as any)._register_in_ha();
        tag.scan("04A1B2");
        const onState = published.filter(p => p.topic == `${BASE}/stat`);
        expect(onState.map(p => p.payload)).toEqual(["04A1B2"]);
    });
});
