import { autocleanEntities, autoCleanEntitiesKey, registerAutocleaner, type AutoCleanEntry } from "./auto_cleaning";
import { HyperWrapper } from "../../../hypervisor/managed_apps";

function setup(registry: Record<string, AutoCleanEntry>, tracked: string[] = []) {
    const plugin = { [HyperWrapper]: { id: 'ha' } } as any;
    const key = autoCleanEntitiesKey(plugin);
    const kv: Record<string, any> = { [key]: registry };
    const destroyed: any[] = [];
    registerAutocleaner({ key: 'test', make_entry: () => ({}), destroy_entity: async (opts) => { destroyed.push(opts) } });
    const store = {
        plugin,
        tracked_entities: new Set(tracked.map(uuid => ({ uuid, domain: 'sensor' }))),
        application: { persistedStorage: { getValue: (k: string) => kv[k], setValue: (k: string, v: any) => { kv[k] = v } } },
    } as any;
    return { store, kv, destroyed, key };
}

const entry = (uuid: string): AutoCleanEntry => ({ uuid, cleaner_key: 'test', cleaner_opts: { id: uuid } });

describe('autocleanEntities', () => {
    it('destroys every entry the app no longer tracks and keeps the tracked ones', async () => {
        const { store, kv, destroyed, key } = setup({ 'a-sensor': entry('a'), 'b-sensor': entry('b') }, ['b']);
        expect(await autocleanEntities(store)).toEqual([]);
        expect(destroyed).toEqual([{ id: 'a' }]);
        expect(Object.keys(kv[key])).toEqual(['b-sensor']);
    });

    it('keeps an entry whose HA removal failed (so a later run retries it) and reports it', async () => {
        const { store, kv, destroyed, key } = setup({ 'a-sensor': { ...entry('a'), cleaner_key: 'boom' }, 'b-sensor': entry('b') });
        registerAutocleaner({ key: 'boom', make_entry: () => ({}), destroy_entity: async () => { throw new Error('ha down') } });
        const failures = await autocleanEntities(store);
        expect(failures).toEqual([{ uuid: 'a', error: expect.objectContaining({ message: 'ha down' }) }]);
        expect(destroyed).toEqual([{ id: 'b' }]);
        expect(Object.keys(kv[key])).toEqual(['a-sensor']);
    });
});
