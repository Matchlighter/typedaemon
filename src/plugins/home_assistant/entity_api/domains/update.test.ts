import { BASE, discovered, lastState } from "../../../../../test/helpers/entity_api";
import { TDUpdate } from "./update";

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
