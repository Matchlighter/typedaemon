import "../../test/helpers/mock_hypervisor";

import { useTempDir } from "../../test/helpers/fs";
import { CrossAppCall, CrossCallError, CrossCallStore, UnknownCrossCallError } from "./cross_call";

describe("CrossCallStore.cancelCall", () => {
    const tmp = useTempDir("td-crosscall-");
    let store: CrossCallStore;

    // Target app is not started, so calls stay `pending`; the source is not started either, so results are persisted
    const apps: Record<string, any> = { src: { uuid: 'src', state: 'stopped' }, dst: { uuid: 'dst', state: 'stopped' } };

    beforeEach(() => {
        store = new CrossCallStore({ operations_directory: tmp.path(), getApplication: (id: string) => apps[id] } as any);
    });
    afterEach(async () => { await store.dispose() });

    /** Seed a call as `makeCrossAppCall` would persist it (that needs a resumable-promise context we don't want here) */
    const call = (over: Partial<CrossAppCall> = {}) => {
        const c: CrossAppCall = { uuid: `c${seq++}`, source_app: 'src', target_app: 'dst', method: 'open', parameters: [], status: 'pending', awaited: true, ...over };
        (store as any).writeCall(c);
        return c;
    };
    let seq = 0;

    it("rejects a pending awaited call: it becomes a returning reject_error naming the cancel", () => {
        const c = call();
        expect(c.status).toBe('pending');
        store.cancelCall(c.uuid);
        const after = store.listCalls().find(x => x.uuid == c.uuid) as CrossAppCall;
        expect(after).toMatchObject({ status: 'returning', result: 'reject_error' });
        expect(after.value).toContain('Cancelled');
    });

    it("drops a pending fire-and-forget call", () => {
        const c = call({ awaited: false });
        store.cancelCall(c.uuid);
        expect(store.listCalls()).toEqual([]);
    });

    it("refuses a call that is no longer pending", () => {
        const c = call();
        store.cancelCall(c.uuid); // now `returning`
        expect(() => store.cancelCall(c.uuid)).toThrow(CrossCallError);
        expect(() => store.cancelCall(c.uuid)).toThrow(/returning/);
    });

    it("throws UnknownCrossCallError for an unknown uuid", () => {
        expect(() => store.cancelCall('nope')).toThrow(UnknownCrossCallError);
    });
});
