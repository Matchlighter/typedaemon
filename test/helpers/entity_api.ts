/**
 * Shared harness for entity domain tests. Import it BEFORE the module under test so the mocks below are registered
 * before the entity code (and its `ha`/`plgmobx` imports) load.
 */
jest.mock('../../src/plugins', () => ({ ha: { application_device: { name: "App Device" } } }));
jest.mock('../../src/plugins/mobx', () => {
    const mobx = jest.requireActual('mobx');
    return { plgmobx: { reaction: (_app: any, ...args: any[]) => (mobx.reaction as any)(...args) } };
});

/** Topic prefix of an entity created with id `"uuid:ent1"` */
export const BASE = "td/apps/app1/entities/ent1";

export type Published = { topic: string, payload: any, opts?: any };

/** In-memory MQTT store recording publishes and subscriptions */
export function fakeStore() {
    const subscriptions: Record<string, (topic: string, payload: any) => void> = {};
    const published: Published[] = [];
    const publish = (topic: string, payload: any, opts?: any) => { published.push({ topic, payload, opts }) };
    const store = {
        mqtt_system_topic: "td",
        mqtt_application_topic: "td/apps/app1",
        application: {},
        mqttApi: () => ({
            publish,
            subscribe: (topic: string, cb: any) => {
                subscriptions[topic] = cb;
                return () => { delete subscriptions[topic] };
            },
        }),
        mqttConnection: () => ({ publish }),
    };
    return { store, subscriptions, published };
}

/** Bind an entity to a fresh fake store without registering it */
export function bindFakeStore(entity: object) {
    const ctx = fakeStore();
    (entity as any)._bound_store = ctx.store;
    return ctx;
}

/** Bind and register an entity; returns the (latest) discovery payload and a `send(key, payload)` command helper */
export async function discovered(entity: object) {
    const ctx = bindFakeStore(entity);
    await (entity as any)._register_in_ha();
    const discovery = () => {
        const msgs = ctx.published.filter(p => p.topic.startsWith("homeassistant/") && p.topic.endsWith("/config"));
        return JSON.parse(msgs[msgs.length - 1].payload);
    };
    const send = (key: string, payload: any) => {
        const t = key == "command" ? `${BASE}/cmd` : `${BASE}/cmd/${key}`;
        ctx.subscriptions[t](t, payload);
    };
    return { ...ctx, send, discovery, dd: discovery() };
}

/** Last JSON payload published to the entity's state topic */
export const lastState = (published: Published[]) => JSON.parse(published.filter(p => p.topic == `${BASE}/stat`).pop()!.payload);
