jest.mock('../../..', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../../mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});
import { TDCover } from "./cover";

const BASE = "td/apps/app1/entities/ent1";

async function discovered(e: TDCover) {
    const subscriptions: Record<string, (topic: string, payload: any) => void> = {};
    const published: { topic: string, payload: any, opts?: any }[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    (e as any)._bound_store = {
        mqtt_system_topic: "td", mqtt_application_topic: "td/apps/app1", application: {},
        mqttApi: () => ({ publish, subscribe: (t: string, cb: any) => { subscriptions[t] = cb; return () => { } } }),
        mqttConnection: () => ({ publish }),
    };
    await (e as any)._register_in_ha();
    const cfg = published.find(p => p.topic == "homeassistant/cover/ent1/config")!;
    const send = (key: string, payload: any) => {
        const t = key == "command" ? `${BASE}/cmd` : `${BASE}/cmd/${key}`;
        subscriptions[t](t, payload);
    };
    return { subscriptions, published, send, dd: JSON.parse(cfg.payload) };
}

const lastState = (published: any[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);

describe("TDCover", () => {
    it("discovers a basic open/close/stop cover", async () => {
        const { dd, subscriptions } = await discovered(new TDCover("uuid:ent1", { device_class: "garage" }));
        expect(dd).toMatchObject({
            command_topic: `${BASE}/cmd`,
            state_topic: `${BASE}/stat`,
            value_template: "{{ value_json.state }}",
            device_class: "garage",
        });
        expect(dd.position_topic).toBeUndefined();
        expect(dd.set_position_topic).toBeUndefined();
        expect(dd.tilt_command_topic).toBeUndefined();
        expect(Object.keys(subscriptions)).toEqual([`${BASE}/cmd`]);
    });

    it("routes OPEN/CLOSE/STOP to handlers", async () => {
        const e = new TDCover("uuid:ent1");
        const { send } = await discovered(e);
        e.on_open = jest.fn(); e.on_close = jest.fn(); e.on_stop = jest.fn();
        send("command", "OPEN");
        send("command", "CLOSE");
        send("command", "STOP");
        send("command", "bogus");
        expect(e.on_open).toHaveBeenCalledTimes(1);
        expect(e.on_close).toHaveBeenCalledTimes(1);
        expect(e.on_stop).toHaveBeenCalledTimes(1);
        expect(e.state).toBeUndefined();
    });

    it("applies commands optimistically when no handler is set", async () => {
        const e = new TDCover("uuid:ent1");
        const { send, published } = await discovered(e);
        send("command", "OPEN");
        expect(lastState(published).state).toBe("open");
        send("command", "CLOSE");
        expect(lastState(published).state).toBe("closed");
        send("command", "STOP");
        expect(lastState(published).state).toBe("stopped");
    });

    describe("with position", () => {
        it("discovers position + set_position topics and range", async () => {
            const { dd, subscriptions } = await discovered(new TDCover("uuid:ent1", { position: true, position_open: 255, position_closed: 5 }));
            expect(dd).toMatchObject({
                position_topic: `${BASE}/stat`,
                position_template: "{{ value_json.position }}",
                set_position_topic: `${BASE}/cmd/set_position`,
                position_open: 255,
                position_closed: 5,
            });
            expect(dd.position).toBeUndefined();
            expect(Object.keys(subscriptions).sort()).toEqual([`${BASE}/cmd`, `${BASE}/cmd/set_position`]);
        });

        it("publishes position as a state field", async () => {
            const e = new TDCover("uuid:ent1", { position: true });
            const { published } = await discovered(e);
            e.setState("open");
            e.position = 40;
            expect(lastState(published)).toMatchObject({ state: "open", position: 40 });
        });

        it("routes set_position to its handler as a number", async () => {
            const e = new TDCover("uuid:ent1", { position: true });
            const { send } = await discovered(e);
            e.on_set_position = jest.fn();
            send("set_position", "42");
            expect(e.on_set_position).toHaveBeenCalledWith(42);
            expect(e.position).toBeUndefined();
        });

        it("applies position commands optimistically", async () => {
            const e = new TDCover("uuid:ent1", { position: true, position_closed: 10 });
            const { send, published } = await discovered(e);
            send("set_position", "42");
            expect(lastState(published)).toMatchObject({ state: "open", position: 42 });
            send("set_position", "10");
            expect(lastState(published)).toMatchObject({ state: "closed", position: 10 });
            send("command", "OPEN");
            expect(lastState(published)).toMatchObject({ state: "open", position: 100 });
        });
    });

    describe("with tilt", () => {
        it("discovers tilt status + command topics and range", async () => {
            const { dd, subscriptions } = await discovered(new TDCover("uuid:ent1", {
                tilt: true, tilt_min: -90, tilt_max: 90, tilt_closed_value: -90, tilt_opened_value: 0,
            }));
            expect(dd).toMatchObject({
                tilt_status_topic: `${BASE}/stat`,
                tilt_status_template: "{{ value_json.tilt }}",
                tilt_command_topic: `${BASE}/cmd/tilt_command`,
                tilt_min: -90, tilt_max: 90, tilt_closed_value: -90, tilt_opened_value: 0,
            });
            expect(dd.position_topic).toBeUndefined();
            expect(Object.keys(subscriptions).sort()).toEqual([`${BASE}/cmd`, `${BASE}/cmd/tilt_command`]);
        });

        it("routes tilt commands to handlers, else applies optimistically", async () => {
            const e = new TDCover("uuid:ent1", { tilt: true });
            const { send, published } = await discovered(e);
            send("tilt_command", "30");
            expect(lastState(published)).toMatchObject({ tilt: 30 });

            e.on_set_tilt = jest.fn();
            e.on_stop_tilt = jest.fn();
            send("tilt_command", "60");
            send("tilt_command", "stop");
            expect(e.on_set_tilt).toHaveBeenCalledWith(60);
            expect(e.on_stop_tilt).toHaveBeenCalledTimes(1);
            expect(e.tilt).toBe(30);
        });
    });
});
