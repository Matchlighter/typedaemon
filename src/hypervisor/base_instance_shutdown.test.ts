jest.mock('./logging', () => ({ createDomainLogger: () => ({ logMessage() { }, close() { } }), NUMERIC_LOG_LEVELS: {} }));

import { BaseInstance } from './managed_apps';

class Instance extends BaseInstance<any> {
    constructor() {
        super({ hypervisor: {} as any, id: 'x', namespace: {} as any }, {});
    }
    async _start() { this.transitionState('started'); }
    set(state: any) { this.transitionState(state); }
}

describe('BaseInstance shutdown', () => {
    it('beginShutdown enters stopping once, immediately', () => {
        const i = new Instance();
        const seen: string[] = [];
        i.on('lifecycle', s => seen.push(s));
        i.beginShutdown();
        i.beginShutdown();
        expect(i.state).toBe('stopping');
        expect(seen).toEqual(['stopping']);
    });

    it('does not move a stopped instance back to stopping', async () => {
        const i = new Instance();
        await i._shutdown();
        i.beginShutdown();
        expect(i.state).toBe('stopped');
    });

    it('is `stopping` while the cleanups run, and `stopped` only after they finish', async () => {
        const i = new Instance();
        const during: string[] = [];
        i.cleanups.push(async () => { during.push(i.state); await Promise.resolve(); during.push(i.state); });
        await i.set('started');
        await i._shutdown();
        expect(during).toEqual(['stopping', 'stopping']);
        expect(i.state).toBe('stopped');
    });

    it('a start still in flight sees `stopping` once shutdown has begun, even if the cleanups have not run', async () => {
        const i = new Instance();
        i.set('starting');
        i.beginShutdown();
        expect(i.state).toBe('stopping');
        // _shutdown after an explicit beginShutdown does not re-announce it
        const seen: string[] = [];
        i.on('lifecycle', s => seen.push(s));
        await i._shutdown();
        expect(seen).toEqual(['stopped']);
    });
});
