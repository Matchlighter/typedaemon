import { AdminChannel, type AdminSocket } from './channel';
import type { ServerMessage } from './protocol';
import { ActionRegistry } from './actions';
import { TopicRegistry } from './topics';

function fakeSocket() {
    const sent: ServerMessage[] = [];
    let onMessage: (raw: string) => void = () => { };
    let onClose: () => void = () => { };
    const socket: AdminSocket = {
        send: (raw) => sent.push(JSON.parse(raw)),
        onMessage: (cb) => { onMessage = cb },
        onClose: (cb) => { onClose = cb },
    };
    return { socket, sent, receive: (m: any) => onMessage(JSON.stringify(m)), close: () => onClose() };
}

function setup() {
    const registry = new TopicRegistry();
    const emitters: Record<string, (d: any) => void> = {};
    const unsubs: string[] = [];
    // Not a real topic: bypass the `TopicMap` typing
    (registry.register as (topic: string, provider: any) => () => void).call(registry, 'echo', {
        snapshot: (params: any) => ({ hello: params?.name ?? 'world' }),
        subscribe: (params: any, emit) => {
            const key = params?.name ?? 'world';
            emitters[key] = emit;
            return () => { unsubs.push(key) };
        },
    });
    const fake = fakeSocket();
    new AdminChannel(registry, fake.socket);
    return { fake, emitters, unsubs };
}

const tick = () => new Promise(r => setImmediate(r));

describe('AdminChannel', () => {
    it('answers subscribe with a snapshot', async () => {
        const { fake } = setup();
        fake.receive({ type: 'subscribe', id: 1, topic: 'echo', params: { name: 'a' } });
        await tick();
        expect(fake.sent).toEqual([{ type: 'snapshot', id: 1, data: { hello: 'a' } }]);
    });

    it('forwards provider deltas after the snapshot, tagged with the subscription id', async () => {
        const { fake, emitters } = setup();
        fake.receive({ type: 'subscribe', id: 7, topic: 'echo' });
        await tick();
        emitters['world']({ hello: 'again' });
        expect(fake.sent[1]).toEqual({ type: 'delta', id: 7, data: { hello: 'again' } });
    });

    it('unsubscribe stops deltas and releases the provider', async () => {
        const { fake, emitters, unsubs } = setup();
        fake.receive({ type: 'subscribe', id: 1, topic: 'echo' });
        await tick();
        fake.receive({ type: 'unsubscribe', id: 1 });
        emitters['world']({ hello: 'late' });
        expect(fake.sent).toHaveLength(1);
        expect(unsubs).toEqual(['world']);
    });

    it('releases all subscriptions when the socket closes', async () => {
        const { fake, unsubs } = setup();
        fake.receive({ type: 'subscribe', id: 1, topic: 'echo', params: { name: 'a' } });
        fake.receive({ type: 'subscribe', id: 2, topic: 'echo', params: { name: 'b' } });
        await tick();
        fake.close();
        expect(unsubs.sort()).toEqual(['a', 'b']);
    });

    it('reports unknown topics as errors', async () => {
        const { fake } = setup();
        fake.receive({ type: 'subscribe', id: 3, topic: 'nope' });
        await tick();
        expect(fake.sent[0]).toMatchObject({ type: 'error', id: 3 });
    });

    it('ignores malformed messages', async () => {
        const { fake } = setup();
        expect(() => fake.receive('garbage')).not.toThrow();
        await tick();
        expect(fake.sent).toEqual([]);
    });
});

describe('AdminChannel actions', () => {
    function actionSetup() {
        const actions = new ActionRegistry();
        const calls: any[] = [];
        actions.register('app.restart', async (params: any) => { calls.push(params); });
        actions.register('app.stop', async () => { throw new Error('nope') });
        actions.register('storage.value', async ({ key }: any) => ({ got: key }));
        const fake = fakeSocket();
        new AdminChannel(new TopicRegistry(), fake.socket, actions);
        return { fake, calls };
    }

    it('runs the action and answers ok', async () => {
        const { fake, calls } = actionSetup();
        fake.receive({ type: 'call', id: 4, action: 'app.restart', params: { id: 'lights' } });
        await tick();
        expect(calls).toEqual([{ id: 'lights' }]);
        expect(fake.sent).toEqual([{ type: 'result', id: 4, ok: true }]);
    });

    it('hands the action result back to the caller', async () => {
        const { fake } = actionSetup();
        fake.receive({ type: 'call', id: 7, action: 'storage.value', params: { app: 'a', key: 'k' } });
        await tick();
        expect(fake.sent).toEqual([{ type: 'result', id: 7, ok: true, data: { got: 'k' } }]);
    });

    it('answers failures with the message', async () => {
        const { fake } = actionSetup();
        fake.receive({ type: 'call', id: 5, action: 'app.stop', params: { id: 'x' } });
        await tick();
        expect(fake.sent).toEqual([{ type: 'result', id: 5, ok: false, message: 'nope' }]);
    });

    it.each([
        ['app.restart', undefined],
        ['app.restart', null],
        ['app.restart', 'lights'],
        ['app.restart', {}],
        ['app.restart', { id: 5 }],
        ['storage.value', { app: 'a' }],
        ['storage.value', { app: 'a', key: { $ne: 1 } }],
    ])('rejects malformed params for %s (%j) without calling the handler', async (action, params) => {
        const { fake, calls } = actionSetup();
        fake.receive({ type: 'call', id: 8, action, params });
        await tick();
        expect(calls).toEqual([]);
        expect(fake.sent).toEqual([{ type: 'result', id: 8, ok: false, message: expect.stringMatching(/^Invalid params for /) }]);
    });

    it('rejects unknown actions', async () => {
        const { fake } = actionSetup();
        fake.receive({ type: 'call', id: 6, action: 'nope' });
        await tick();
        expect(fake.sent).toEqual([{ type: 'result', id: 6, ok: false, message: 'Unknown action: nope' }]);
    });
});
