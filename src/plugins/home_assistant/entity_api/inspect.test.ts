import type { AutoCleanEntry } from "./auto_cleaning";
import { listEntityRows, type EntityInspection } from "./inspect";

const entry = (uuid: string, domain: string, name?: string): AutoCleanEntry =>
    ({ uuid, name, cleaner_key: `k-${domain}`, cleaner_opts: { id: uuid, domain } });

const input = (over: Partial<EntityInspection> = {}): EntityInspection => ({
    pluginId: 'ha', tracked: [], registry: {}, haEntities: {}, haStates: {}, persistedStateUuids: new Set(), ...over,
});

describe('listEntityRows', () => {
    it('lists tracked entities as linked, resolving the HA entity_id and state by unique id', () => {
        const rows = listEntityRows(input({
            tracked: [{ uuid: 'td-1-sensor-temp', domain: 'sensor', name: 'Temp' }],
            haEntities: { 'sensor.temp': { entity_id: 'sensor.temp', unique_id: 'td-1-sensor-temp' } },
            haStates: { 'sensor.temp': { state: 21.4 } },
        }));
        expect(rows).toEqual([{
            key: 'ha:td-1-sensor-temp-sensor', plugin: 'ha', domain: 'sensor', name: 'Temp',
            entityId: 'sensor.temp', state: '21.4', linked: true, autoClean: false, persistState: false,
        }]);
    });

    it('flags auto_clean when the registry knows the tracked entity, and persist_state when its state is persisted', () => {
        const [r] = listEntityRows(input({
            tracked: [{ uuid: 'u', domain: 'sensor' }],
            registry: { 'u-sensor': entry('u', 'sensor') },
            persistedStateUuids: new Set(['u']),
        }));
        expect(r).toMatchObject({ linked: true, autoClean: true, persistState: true });
    });

    it('matches a tracked entity with an entity_kind override to its registry entry (not an unlinked twin)', () => {
        const rows = listEntityRows(input({
            tracked: [{ uuid: 'cam', domain: 'camera', entity_kind: 'stream_camera' }],
            registry: { 'cam-stream_camera': entry('cam', 'camera') },
        }));
        expect(rows.map(r => [r.key, r.linked, r.autoClean])).toEqual([['ha:cam-stream_camera', true, true]]);
    });

    it('lists registry entries nobody tracks as unlinked (auto_clean), with HA entity_id if HA still has it', () => {
        const rows = listEntityRows(input({
            tracked: [{ uuid: 'a', domain: 'sensor' }],
            registry: { 'a-sensor': entry('a', 'sensor'), 'gone-switch': entry('gone', 'switch', 'Old') },
            haEntities: { 'switch.old': { entity_id: 'switch.old', unique_id: 'gone' } },
            haStates: { 'switch.old': { state: 'unavailable' } },
        }));
        expect(rows.find(r => !r.linked)).toEqual({
            key: 'ha:gone-switch', plugin: 'ha', domain: 'switch', name: 'Old', entityId: 'switch.old', state: 'unavailable',
            linked: false, autoClean: true, persistState: false,
        });
        expect(rows).toHaveLength(2);
    });

    it('treats a registry entry whose uuid is tracked under another domain as unlinked', () => {
        const rows = listEntityRows(input({
            tracked: [{ uuid: 'a', domain: 'switch' }],
            registry: { 'a-light': entry('a', 'light') },
        }));
        expect(rows.map(r => [r.key, r.linked])).toEqual([['ha:a-switch', true], ['ha:a-light', false]]);
    });

    it('uses the uuid as entity_id for input helpers (uuid is "<domain>.<id>")', () => {
        const [r] = listEntityRows(input({ tracked: [{ uuid: 'input_boolean.away', domain: 'input_boolean' }] }));
        expect(r.entityId).toBe('input_boolean.away');
    });

    it('leaves entityId/state unset when HA does not know the entity (yet)', () => {
        const [r] = listEntityRows(input({ tracked: [{ uuid: 'u', domain: 'sensor' }] }));
        expect(r.entityId).toBeUndefined();
        expect(r.state).toBeUndefined();
    });
});
