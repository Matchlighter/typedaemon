import { PromiseTimedout, timeoutPromise } from './util';

describe('timeoutPromise', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const never = () => new Promise<string>(() => { });

    it('resolves with the promise result if it settles in time', async () => {
        const p = timeoutPromise(1000, Promise.resolve("ok"));
        await expect(p).resolves.toBe("ok");
    });

    it('propagates rejection if the promise rejects in time', async () => {
        const p = timeoutPromise(1000, Promise.reject(new Error("boom")));
        await expect(p).rejects.toThrow("boom");
    });

    it('rejects with PromiseTimedout when no timeoutAction is given', async () => {
        const p = timeoutPromise(1000, never());
        jest.advanceTimersByTime(1000);
        await expect(p).rejects.toBeInstanceOf(PromiseTimedout);
    });

    it('resolves with the timeoutAction result on timeout', async () => {
        const p = timeoutPromise(1000, never(), () => "fallback" as any);
        jest.advanceTimersByTime(1000);
        await expect(p).resolves.toBe("fallback");
    });

    it('rejects with the error thrown by timeoutAction', async () => {
        const p = timeoutPromise(1000, never(), () => { throw new Error("too slow") });
        jest.advanceTimersByTime(1000);
        await expect(p).rejects.toThrow("too slow");
    });
});
