import { fakeStore } from "../../../../../test/helpers/entity_api";
import { Autocleaner, SymbolAutocleaner, autocleanEntities, trackAutocleanEntity } from "../auto_cleaning";
import { HyperWrapper } from "../../../../hypervisor/managed_apps";
import { TDCamera } from "./camera";
import { TDStreamCamera } from "./stream_camera";

/** Fake `home-assistant-js-websocket` connection recording subscriptions and one-shot messages */
function fakeWs() {
    const listeners: Record<string, Set<() => void>> = {};
    const subs: { msg: any, options: any, unsubscribed: boolean }[] = [];
    const requests: any[] = [];
    const conn = {
        connected: true,
        subscribeMessage: jest.fn(async (_cb: any, msg: any, options?: any) => {
            const sub = { msg: { ...msg }, options, unsubscribed: false };
            subs.push(sub);
            return async () => { sub.unsubscribed = true };
        }),
        addEventListener: (ev: string, f: () => void) => { (listeners[ev] ||= new Set()).add(f) },
        removeEventListener: (ev: string, f: () => void) => { listeners[ev]?.delete(f) },
        fire: (ev: string) => listeners[ev]?.forEach(f => f()),
        listenerCount: () => Object.values(listeners).reduce((n, s) => n + s.size, 0),
    };
    const plugin = {
        _ha_api: conn,
        request: jest.fn(async (type: string, params: any) => { requests.push({ type, ...params }) }),
    };
    return { conn, plugin, subs, requests };
}

const UID = "td-app1-stream_camera-ent1";

async function registered(ent: TDStreamCamera) {
    const ws = fakeWs();
    const ctx = fakeStore();
    const store = { ...ctx.store, plugin: ws.plugin, application: { uuid: "app1" } };
    (ent as any)._bound_store = store;
    await (ent as any)._register_in_ha();
    await flush();
    return { ...ws, ...ctx, store };
}

const flush = () => new Promise(r => setImmediate(r));

describe("TDStreamCamera", () => {
    it("registers with the companion integration over the HA websocket, not MQTT", async () => {
        const ent = new TDStreamCamera("ent1", { name: "Front Door", still_image_url: "http://cam/still.jpg" });
        ent.setState("rtsp://cam/stream", { fps: 15 });
        const { subs, published } = await registered(ent);

        expect(subs).toHaveLength(1);
        expect(subs[0].msg).toEqual({
            type: "typedaemon/camera/register",
            unique_id: UID,
            name: "Front Door",
            stream_source: "rtsp://cam/stream",
            still_image_url: "http://cam/still.jpg",
            attributes: { fps: 15 },
            device: { name: "App Device" },
        });
        expect(published).toEqual([]);
    });

    it("pushes the full config with typedaemon/camera/update when the stream or attributes change", async () => {
        const ent = new TDStreamCamera("ent1");
        const { requests, subs } = await registered(ent);
        expect(subs[0].msg.stream_source).toBeNull();
        expect(subs[0].msg.name).toBe("ent1");

        ent.setState("http://cam/live.m3u8", { quality: "hd" });
        await flush();

        expect(requests).toEqual([{
            type: "typedaemon/camera/update",
            unique_id: UID,
            name: "ent1",
            stream_source: "http://cam/live.m3u8",
            still_image_url: null,
            attributes: { quality: "hd" },
            device: { name: "App Device" },
        }]);
    });

    it("unlink closes the registration (HA marks it unavailable) and stops pushing updates", async () => {
        const ent = new TDStreamCamera("ent1");
        const { subs, requests, published } = await registered(ent);

        await ent.unlink();
        expect(subs[0].unsubscribed).toBe(true);

        ent.setState("rtsp://late");
        await flush();
        expect(requests).toEqual([]);
        expect(published).toEqual([]);
    });

    it("re-registers with the current config after a websocket reconnect", async () => {
        const ent = new TDStreamCamera("ent1");
        ent.setState("rtsp://old");
        const { conn, subs, requests } = await registered(ent);

        conn.connected = false;
        conn.fire("disconnected");
        ent.setState("rtsp://new");
        await flush();
        expect(requests).toEqual([]); // Not sent while disconnected; the re-registration carries it

        conn.connected = true;
        conn.fire("ready");
        await flush();

        expect(subs.map(s => s.msg.stream_source)).toEqual(["rtsp://old", "rtsp://new"]);
        // HA forgot the old subscription with the dropped connection, so it mustn't be resent by the library
        expect(subs.every(s => s.options?.resubscribe === false)).toBe(true);

        await ent.unlink();
        expect(subs[1].unsubscribed).toBe(true);
        expect(conn.listenerCount()).toBe(0);
    });

    it("ignores a 'ready' that doesn't follow a disconnect", async () => {
        const { conn, subs } = await registered(new TDStreamCamera("ent1"));
        conn.fire("ready");
        await flush();
        expect(subs).toHaveLength(1);
    });

    it("destroy removes the camera from HA", async () => {
        const ent = new TDStreamCamera("ent1");
        const { requests, subs, published } = await registered(ent);

        await ent.destroy();
        expect(requests).toEqual([{ type: "typedaemon/camera/remove", unique_id: UID }]);
        expect(subs[0].unsubscribed).toBe(true);
        expect(published).toEqual([]);
    });

    it("autoclean removes a no-longer-declared camera from HA, separately from MQTT cameras", async () => {
        const cleaner: Autocleaner = (TDStreamCamera as any)[SymbolAutocleaner];
        expect(cleaner.key).not.toEqual((TDCamera as any)[SymbolAutocleaner].key);

        const { store, requests } = await registered(new TDStreamCamera("ent1"));
        const entry = JSON.parse(JSON.stringify(cleaner.make_entry(new TDStreamCamera("ent1"))));

        await cleaner.destroy_entity(entry, store as any);
        expect(requests).toEqual([{ type: "typedaemon/camera/remove", unique_id: UID }]);
    });

    it("autoclean cleans up the MQTT camera when a verbatim ('/') id switches to a stream camera", async () => {
        const ws = fakeWs();
        const ctx = fakeStore();
        let saved: Record<string, any> = {};
        const persistedStorage = {
            objectSet: (_key: string, sub: string, v: any) => { saved[sub] = v },
            getValue: () => saved,
            setValue: (_key: string, v: any) => { saved = v },
        };
        const store: any = {
            ...ctx.store, plugin: { ...ws.plugin, [HyperWrapper]: { id: "ha" } }, tracked_entities: new Set(),
            application: { uuid: "app1", persistedStorage },
        };
        const bind = <T>(e: T) => { (e as any)._bound_store = store; return e };

        // Previous run declared an MQTT camera, this one a stream camera, both with the same verbatim uuid
        trackAutocleanEntity(store, bind(new TDCamera("/cam")));
        const stream = bind(new TDStreamCamera("/cam"));
        trackAutocleanEntity(store, stream);
        store.tracked_entities.add(stream);

        await autocleanEntities(store);

        expect(ctx.published).toContainEqual(expect.objectContaining({ topic: "homeassistant/camera/cam/config", payload: null }));
        expect(ws.requests).toEqual([]);
        expect(Object.values(saved).map(e => e.cleaner_key)).toEqual([(TDStreamCamera as any)[SymbolAutocleaner].key]);
    });
});
