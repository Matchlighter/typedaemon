import { BASE, discovered, fakeStore } from "../../../../test/helpers/entity_api";
import { SymbolAutocleaner, Autocleaner } from "./auto_cleaning";
import { EntityClass } from "./domains/base";
import { TDSwitch } from "./domains/switch";

class MultiTopicEntity extends EntityClass<string, {}, { presets?: boolean }> {
    static domain = "multi";
    static { this._defaultAutocleaner(); }

    received: [any, string][] = [];

    protected command_keys() {
        const keys = [...super.command_keys(), "set_position"];
        if (this.options.presets) keys.push("preset_mode_command");
        return keys;
    }

    handle_command(payload: any, key: string) {
        this.received.push([payload, key]);
    }
}


describe("multi-topic command entities", () => {
    it("subscribes each named command topic and routes payload + key", async () => {
        const ent = new MultiTopicEntity("uuid:ent1", { presets: true });
        const { subscriptions } = await discovered(ent);

        expect(Object.keys(subscriptions).sort()).toEqual([
            `${BASE}/cmd`,
            `${BASE}/cmd/preset_mode_command`,
            `${BASE}/cmd/set_position`,
        ]);

        subscriptions[`${BASE}/cmd/set_position`](`${BASE}/cmd/set_position`, "42");
        subscriptions[`${BASE}/cmd/preset_mode_command`](`${BASE}/cmd/preset_mode_command`, "eco");
        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "OPEN");

        expect(ent.received).toEqual([
            ["42", "set_position"],
            ["eco", "preset_mode_command"],
            ["OPEN", "command"],
        ]);
    });

    it("advertises each named command topic in discovery as <key>_topic", async () => {
        const { discovery } = await discovered(new MultiTopicEntity("uuid:ent1", { presets: true }));
        expect(discovery()).toMatchObject({
            command_topic: `${BASE}/cmd`,
            set_position_topic: `${BASE}/cmd/set_position`,
            preset_mode_command_topic: `${BASE}/cmd/preset_mode_command`,
        });
    });

    it("autoclean clears every command topic, including option-dependent ones", async () => {
        const ent = new MultiTopicEntity("uuid:ent1", { presets: true });
        const { store } = await discovered(ent);

        const cleaner: Autocleaner = (MultiTopicEntity as any)[SymbolAutocleaner];
        // Persisted entry round-trips through JSON storage
        const entry = JSON.parse(JSON.stringify(cleaner.make_entry(ent)));

        const later = fakeStore();
        await cleaner.destroy_entity(entry, { ...later.store } as any);

        const cleared = later.published.filter(p => p.payload === null && p.opts?.retain).map(p => p.topic);
        expect(cleared).toEqual(expect.arrayContaining([
            "homeassistant/multi/ent1/config",
            `${BASE}/cmd`,
            `${BASE}/cmd/set_position`,
            `${BASE}/cmd/preset_mode_command`,
        ]));
    });

    it("leaves single-topic domains unchanged", async () => {
        const sw = new TDSwitch("uuid:ent1");
        const { subscriptions, discovery } = await discovered(sw);

        expect(Object.keys(subscriptions)).toEqual([`${BASE}/cmd`]);
        expect(Object.keys(discovery()).filter(k => k.endsWith("_topic")).sort()).toEqual([
            "command_topic", "json_attributes_topic", "state_topic",
        ]);

        subscriptions[`${BASE}/cmd`](`${BASE}/cmd`, "ON");
        expect(sw.state).toBe(true);
    });
});

class FieldStateEntity extends EntityClass<string, {}> {
    static domain = "fields";
    position = 30;
    protected getStateFields() {
        return { position: this.position };
    }
}

describe("per-field state", () => {
    it("publishes extra fields alongside state in the JSON state payload", async () => {
        const ent = new FieldStateEntity("uuid:ent1");
        ent.setState("open");
        const { published } = await discovered(ent);

        const states = published.filter(p => p.topic == `${BASE}/stat`).map(p => JSON.parse(p.payload));
        expect(states[states.length - 1]).toEqual({ state: "open", attrs: {}, position: 30 });
    });
});
