import { autoCleanEntitiesKey, destroyUnlinkedEntity, registerAutocleaner, type AutoCleanEntry } from "./auto_cleaning";
import { HyperWrapper } from "../../../hypervisor/managed_apps";

function setup(registry: Record<string, AutoCleanEntry>, tracked: string[] = []) {
    const kv: Record<string, any> = {};
    const events: any[] = [];
    const plugin = { [HyperWrapper]: { id: 'ha' }, entityEvents: { emit: (...a: any[]) => events.push(a) } } as any;
    kv[autoCleanEntitiesKey(plugin)] = registry;
    const destroyed: any[] = [];
    registerAutocleaner({ key: 'test', make_entry: () => ({}), destroy_entity: async (opts) => { destroyed.push(opts) } });
    const store = {
        plugin,
        tracked_entities: new Set(tracked.map(uuid => ({ uuid, domain: 'sensor' }))),
        application: {
            persistedStorage: {
                getValue: (k: string) => kv[k],
                setValue: (k: string, v: any) => { kv[k] = v },
                objectSet: (k: string, sub: string, v: any) => { if (v === undefined) delete kv[k][sub]; else kv[k][sub] = v },
            },
        },
    } as any;
    return { store, events, kv, destroyed, key: autoCleanEntitiesKey(plugin) };
}

const entry = (uuid: string): AutoCleanEntry => ({ uuid, cleaner_key: 'test', cleaner_opts: { id: uuid } });

describe('destroyUnlinkedEntity', () => {
    it('destroys the entity in HA and drops it from the autoclean registry', async () => {
        const { store, kv, destroyed, key } = setup({ 'a-sensor': entry('a'), 'b-sensor': entry('b') });
        await destroyUnlinkedEntity(store, 'a-sensor');
        expect(destroyed).toEqual([{ id: 'a' }]);
        expect(Object.keys(kv[key])).toEqual(['b-sensor']);
    });

    it('announces the change so counts and lists refresh', async () => {
        const { store, events } = setup({ 'a-sensor': entry('a') });
        await destroyUnlinkedEntity(store, 'a-sensor');
        expect(events).toEqual([['change', store.application]]);
    });

    it('refuses entities the running app still tracks', async () => {
        const { store, kv, destroyed, key } = setup({ 'a-sensor': entry('a') }, ['a']);
        await expect(destroyUnlinkedEntity(store, 'a-sensor')).rejects.toThrow(/still linked/);
        expect(destroyed).toEqual([]);
        expect(Object.keys(kv[key])).toEqual(['a-sensor']);
    });

    it('rejects unknown keys', async () => {
        const { store } = setup({});
        await expect(destroyUnlinkedEntity(store, 'nope')).rejects.toThrow(/No unlinked entity/);
    });

    it('keeps the registry entry when HA removal fails, so it can be retried', async () => {
        const { store, kv, key } = setup({ 'a-sensor': { ...entry('a'), cleaner_key: 'boom' } });
        registerAutocleaner({ key: 'boom', make_entry: () => ({}), destroy_entity: async () => { throw new Error('mqtt down') } });
        await expect(destroyUnlinkedEntity(store, 'a-sensor')).rejects.toThrow('mqtt down');
        expect(Object.keys(kv[key])).toEqual(['a-sensor']);
    });
});
