import { BASE, discovered, lastState } from "../../../../../test/helpers/entity_api";
import { runInAction } from "mobx";
import { TDAlarmControlPanel } from "./alarm_control_panel";

describe("TDAlarmControlPanel", () => {
    it("discovers with JSON command template and string state", async () => {
        const { dd, subscriptions } = await discovered(new TDAlarmControlPanel("uuid:ent1"));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            state_topic: `${BASE}/stat`,
            value_template: "{{ value_json.state }}",
            command_template: '{"action":"{{ action }}","code":{{ code | tojson }}}',
        });
        expect(Object.keys(subscriptions)).toEqual([`${BASE}/cmd`]);
    });

    it("passes code options and supported_features", async () => {
        const { dd } = await discovered(new TDAlarmControlPanel("uuid:ent1", {
            code: "REMOTE_CODE", code_arm_required: false, code_disarm_required: true, code_trigger_required: false,
            supported_features: ["arm_home", "arm_away"],
        }));
        expect(dd).toMatchObject({
            code: "REMOTE_CODE", code_arm_required: false, code_disarm_required: true, code_trigger_required: false,
            supported_features: ["arm_home", "arm_away"],
        });
    });

    it("omits unset options", async () => {
        const { dd } = await discovered(new TDAlarmControlPanel("uuid:ent1"));
        for (const k of ["code", "code_arm_required", "supported_features"]) expect(dd).not.toHaveProperty(k);
    });

    it.each([
        ["ARM_HOME", "armed_home"], ["ARM_AWAY", "armed_away"], ["ARM_NIGHT", "armed_night"],
        ["ARM_VACATION", "armed_vacation"], ["ARM_CUSTOM_BYPASS", "armed_custom_bypass"],
        ["TRIGGER", "triggered"], ["DISARM", "disarmed"],
    ])("applies %s optimistically -> %s", async (action, state) => {
        const e = new TDAlarmControlPanel("uuid:ent1");
        const { send, published } = await discovered(e);
        send("command", JSON.stringify({ action, code: "" }));
        expect(lastState(published)).toMatchObject({ state });
        expect(e.state).toBe(state);
    });

    it("routes to handlers with code instead of applying", async () => {
        const e = new TDAlarmControlPanel("uuid:ent1");
        const { send } = await discovered(e);
        e.on_arm_home = jest.fn(); e.on_arm_away = jest.fn(); e.on_arm_night = jest.fn();
        e.on_arm_vacation = jest.fn(); e.on_arm_custom_bypass = jest.fn(); e.on_disarm = jest.fn(); e.on_trigger = jest.fn();
        send("command", JSON.stringify({ action: "ARM_HOME", code: "1234" }));
        send("command", JSON.stringify({ action: "ARM_AWAY", code: null }));
        send("command", JSON.stringify({ action: "ARM_NIGHT", code: "" }));
        send("command", JSON.stringify({ action: "ARM_VACATION", code: "" }));
        send("command", JSON.stringify({ action: "ARM_CUSTOM_BYPASS", code: "" }));
        send("command", JSON.stringify({ action: "DISARM", code: "9" }));
        send("command", JSON.stringify({ action: "TRIGGER", code: "" }));
        expect(e.on_arm_home).toHaveBeenCalledWith("1234");
        expect(e.on_arm_away).toHaveBeenCalledWith(undefined);
        expect(e.on_arm_night).toHaveBeenCalledWith(undefined);
        expect(e.on_disarm).toHaveBeenCalledWith("9");
        for (const h of [e.on_arm_vacation, e.on_arm_custom_bypass, e.on_trigger]) expect(h).toHaveBeenCalledTimes(1);
        expect(e.state).toBeUndefined();
    });

    it("accepts bare action payloads and ignores unknown ones", async () => {
        const e = new TDAlarmControlPanel("uuid:ent1");
        const { send } = await discovered(e);
        send("command", "ARM_AWAY");
        expect(e.state).toBe("armed_away");
        send("command", "bogus");
        send("command", "{not json");
        expect(e.state).toBe("armed_away");
    });

    it("publishes transitional states set by the app", async () => {
        const e = new TDAlarmControlPanel("uuid:ent1");
        const { published } = await discovered(e);
        runInAction(() => { e.state = "arming" });
        expect(lastState(published)).toMatchObject({ state: "arming" });
    });
});
