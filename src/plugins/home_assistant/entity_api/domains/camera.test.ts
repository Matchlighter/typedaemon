import { BASE, discovered } from "../../../../../test/helpers/entity_api";
import { TDCamera } from "./camera";

describe("TDCamera", () => {
    it("discovers with image topic, no state/command topics", async () => {
        const { dd, subscriptions } = await discovered(new TDCamera("uuid:ent1", { image_encoding: "b64" }));
        expect(dd).toMatchObject({
            topic: `${BASE}/image`,
            image_encoding: "b64",
            json_attributes_topic: `${BASE}/stat`,
            json_attributes_template: "{{ value_json.attrs }}",
        });
        for (const k of ["state_topic", "value_template", "command_topic"]) expect(dd[k]).toBeUndefined();
        expect(Object.keys(subscriptions)).toEqual([]);
    });

    it("publishes raw image bytes (not JSON) on the image topic", async () => {
        const e = new TDCamera("uuid:ent1");
        const { published } = await discovered(e);
        const img = Buffer.from([0xff, 0xd8, 0xff]);
        e.setState(img, { fps: 5 });
        const p = published.filter(p => p.topic == `${BASE}/image`).pop()!;
        expect(p.payload).toBe(img);
        expect(JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload)).toEqual({ attrs: { fps: 5 } });
    });

    it("publishes nothing on the image topic while there is no image", async () => {
        const { published } = await discovered(new TDCamera("uuid:ent1"));
        expect(published.filter(p => p.topic == `${BASE}/image`)).toEqual([]);
    });

    it("clears image topic on destroy", async () => {
        const e = new TDCamera("uuid:ent1");
        const { published } = await discovered(e);
        await e._destroy();
        expect(published.find(p => p.topic == `${BASE}/image` && p.payload === null)).toBeDefined();
    });
});
