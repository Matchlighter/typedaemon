import { BASE, discovered, lastState } from "../../../../../test/helpers/entity_api";
import { TDVacuum } from "./vacuum";

describe("TDVacuum", () => {
    it("discovers command + state topics, no value_template", async () => {
        const { dd, subscriptions } = await discovered(new TDVacuum("uuid:ent1"));
        expect(dd).toMatchObject({ command_topic: `${BASE}/cmd`, state_topic: `${BASE}/stat` });
        expect(dd.value_template).toBeUndefined();
        for (const k of ["set_fan_speed_topic", "send_command_topic", "fan_speed_list", "supported_features"]) {
            expect(dd[k]).toBeUndefined();
        }
        expect(Object.keys(subscriptions)).toEqual([`${BASE}/cmd`]);
    });

    it("publishes state strings in JSON", async () => {
        const e = new TDVacuum("uuid:ent1");
        const { published } = await discovered(e);
        e.state = "cleaning";
        await new Promise(r => setTimeout(r, 0));
        expect(lastState(published)).toMatchObject({ state: "cleaning" });
    });

    it("passes supported_features", async () => {
        const { dd } = await discovered(new TDVacuum("uuid:ent1", { supported_features: ["start", "pause", "locate"] }));
        expect(dd.supported_features).toEqual(["start", "pause", "locate"]);
    });

    it("routes commands to handlers, else ignores; unknown payloads dropped", async () => {
        const e = new TDVacuum("uuid:ent1");
        const { send } = await discovered(e);
        const names = ["start", "pause", "stop", "return_to_base", "clean_spot", "locate"] as const;
        for (const n of names) (e as any)[`on_${n}`] = jest.fn();
        for (const n of names) send("command", n);
        send("command", "bogus");
        for (const n of names) expect((e as any)[`on_${n}`]).toHaveBeenCalledTimes(1);
    });

    it("honours custom payloads", async () => {
        const e = new TDVacuum("uuid:ent1", { payload_start: "go", payload_return_to_base: "home" });
        const { dd, send } = await discovered(e);
        expect(dd).toMatchObject({ payload_start: "go", payload_return_to_base: "home" });
        e.on_start = jest.fn(); e.on_return_to_base = jest.fn();
        send("command", "go"); send("command", "home"); send("command", "start");
        expect(e.on_start).toHaveBeenCalledTimes(1);
        expect(e.on_return_to_base).toHaveBeenCalledTimes(1);
    });

    describe("fan speed", () => {
        it("discovers and publishes fan_speed", async () => {
            const e = new TDVacuum("uuid:ent1", { fan_speed_list: ["min", "max"] });
            const { dd, subscriptions, send, published } = await discovered(e);
            expect(dd).toMatchObject({ fan_speed_list: ["min", "max"], set_fan_speed_topic: `${BASE}/cmd/set_fan_speed` });
            expect(Object.keys(subscriptions)).toContain(`${BASE}/cmd/set_fan_speed`);
            send("set_fan_speed", "max");
            expect(lastState(published)).toMatchObject({ fan_speed: "max" });
            send("set_fan_speed", "nope");
            expect(e.fan_speed).toBe("max");
            e.on_set_fan_speed = jest.fn();
            send("set_fan_speed", "min");
            expect(e.on_set_fan_speed).toHaveBeenCalledWith("min");
            expect(e.fan_speed).toBe("max");
        });
    });

    describe("send_command", () => {
        it("discovers and routes raw/JSON payloads", async () => {
            const e = new TDVacuum("uuid:ent1", { send_command: true });
            const { dd, send } = await discovered(e);
            expect(dd.send_command_topic).toBe(`${BASE}/cmd/send_command`);
            e.on_send_command = jest.fn();
            send("send_command", "dock");
            send("send_command", '{"command":"go_to","x":1}');
            send("send_command", { command: "spot", y: 2 }); // already JSON-decoded by the subscription
            expect(e.on_send_command).toHaveBeenNthCalledWith(1, "dock");
            expect(e.on_send_command).toHaveBeenNthCalledWith(2, "go_to", { x: 1 });
            expect(e.on_send_command).toHaveBeenNthCalledWith(3, "spot", { y: 2 });
        });

        it("ignores malformed JSON and JSON without a command", async () => {
            const e = new TDVacuum("uuid:ent1", { send_command: true });
            const { send } = await discovered(e);
            e.on_send_command = jest.fn();
            send("send_command", '{"command":');
            send("send_command", '{"x":1}');
            expect(e.on_send_command).not.toHaveBeenCalled();
        });
    });
});
