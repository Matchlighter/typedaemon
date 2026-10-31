import { startHeartbeat } from './heartbeat';

describe('startHeartbeat', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const make = (ping: () => Promise<unknown>) => {
        const onDead = jest.fn();
        const hb = startHeartbeat({ ping, isConnected: () => true, onDead, intervalMs: 1000, timeoutMs: 200 });
        return { hb, onDead };
    };

    it('stays connected while an idle HA answers pings', async () => {
        const ping = jest.fn(() => Promise.resolve('pong'));
        const { hb, onDead } = make(ping);
        for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(1000);
        expect(ping).toHaveBeenCalledTimes(5);
        expect(onDead).not.toHaveBeenCalled();
        hb.stop();
    });

    it('reconnects when no pong arrives in time', async () => {
        const { hb, onDead } = make(() => new Promise(() => { }));
        await jest.advanceTimersByTimeAsync(1100);
        expect(onDead).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(200);
        expect(onDead).toHaveBeenCalledTimes(1);
        hb.stop();
    });

    it('counts any received message as liveness', async () => {
        const { hb, onDead } = make(() => new Promise(() => { }));
        await jest.advanceTimersByTimeAsync(1100);
        hb.touch();
        await jest.advanceTimersByTimeAsync(200);
        expect(onDead).not.toHaveBeenCalled();
        hb.stop();
    });
});
