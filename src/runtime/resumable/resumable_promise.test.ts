// Mock dependencies before importing to avoid circular dependencies
jest.mock('../../hypervisor/current', () => ({
    current: {
        application: {
            resumableStore: null
        }
    }
}));

jest.mock('../../hypervisor/logging', () => ({
    logMessage: jest.fn()
}));

import { ResumablePromise, SettledPromise, ResumableAllPromise, ResumableAllSettledPromise, PromiseCancelled, CancellableResumablePromise, resumableCallbackFactory } from './resumable_promise';

// Mock the ResumableStore
class MockResumableStore {
    state: 'active' | 'shutdown_requested' | 'suspending' | 'suspended' = 'active';
    computeBatcher = {
        perform: (fn: () => void) => fn()
    };

    trackedPromises = [];

    pause() {
        this.state = 'suspending';
        for (let promise of this.trackedPromises) {
            promise.compute_paused();
        }
    }

    track(promise: ResumablePromise<any>) {
        this.trackedPromises.push(promise);
    }
}

// Create a simple test ResumablePromise implementation
class TestResumablePromise<T> extends ResumablePromise<T> {
    constructor(
        private executor?: (resolve: (value: T) => void, reject: (reason: any) => void) => void
    ) {
        super();
        if (executor) {
            executor(this.resolve.bind(this), this.reject.bind(this));
        }
    }

    private dependencies = [];

    dependsOn(p) {
        this.dependencies.push(p);
    }

    serialize(ctx: any) {
        ctx.set_type('test');
        ctx.side_effects(true);
        return {
            test: true,
            deps: this.dependencies.map((d: any) => ctx.ref(d))
        };
    }

    static {
        ResumablePromise.defineClass<TestResumablePromise<any>>({
            type: 'test',
            resumer: (data, { require }) => {
                return new TestResumablePromise();
            },
        });
    }
}


describe('ResumablePromise', () => {
    let mockStore: MockResumableStore;
    
    function pause() {
        mockStore.pause();
    }

    beforeEach(() => {
        mockStore = new MockResumableStore();
        // Override the get_store method
        ResumablePromise.get_store = () => mockStore as any;
    });

    describe('Basic Promise Functionality', () => {
        it('should resolve successfully', async () => {
            const promise = new TestResumablePromise<number>((resolve) => {
                resolve(42);
            });

            const result = await promise;
            expect(result).toBe(42);
            expect(promise.settled).toBe(true);
            expect(promise.promise_state).toBe('accepted');
            expect(promise.promise_value).toBe(42);
        });

        it('should reject with error', async () => {
            const error = new Error('Test error');
            const promise = new TestResumablePromise<number>((_, reject) => {
                reject(error);
            });

            await expect(promise).rejects.toThrow('Test error');
            expect(promise.settled).toBe(true);
            expect(promise.promise_state).toBe('rejected');
            expect(promise.promise_value).toBe(error);
        });

        it('should handle then callbacks', async () => {
            const promise = new TestResumablePromise<number>((resolve) => {
                resolve(10);
            });

            const result = await promise.then(x => x * 2);
            expect(result).toBe(20);
        });

        it('should handle catch callbacks', async () => {
            const promise = new TestResumablePromise<number>((_, reject) => {
                reject(new Error('Test error'));
            });

            const result = await promise.catch(err => 'handled');
            expect(result).toBe('handled');
        });

        it('should handle finally callbacks', async () => {
            let finallyCalled = false;
            const promise = new TestResumablePromise<number>((resolve) => {
                resolve(42);
            });

            await promise.finally(() => {
                finallyCalled = true;
            });

            expect(finallyCalled).toBe(true);
        });
    });

    describe('Suspension Logic', () => {
        it('should track non-resumable awaiters', () => {
            const promise = new TestResumablePromise<number>();

            // Non-resumable awaiter
            promise.then(x => x);

            expect((promise as any).has_non_resumable_awaiters).toBe(true);
        });

        it('should track resumable awaiters', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<number>();

            promise1.then(x => x, undefined, promise2);

            expect((promise1 as any).resumable_awaiters).toContain(promise2);
        });

        it('should suspend when store is suspending and no non-resumable awaiters', () => {
            const promise = new TestResumablePromise<number>();
            pause();

            expect(promise.suspended).toBe(true);
        });

        it('should not suspend with non-resumable awaiters', () => {
            const promise = new TestResumablePromise<number>();

            promise.then(x => x); // Non-resumable awaiter
            pause();

            expect(promise.suspended).toBe(false);
        });

        it('should not suspend when store is active', () => {
            const promise = new TestResumablePromise<number>();
            mockStore.state = 'active';

            promise.compute_paused();

            expect(promise.suspended).toBe(false);
        });

        it('should force suspend', () => {
            const promise = new TestResumablePromise<number>();

            promise.force_suspend();

            expect(promise.suspended).toBe(true);
            expect(promise.force_suspended).toBe(true);
        });
    });

    describe('Serialization', () => {
        it('should serialize a simple promise', () => {
            const promise = new TestResumablePromise<number>();

            pause();

            const serialized = ResumablePromise.serialize_all([promise]);

            expect(serialized.length).toBeGreaterThan(0);
            expect(serialized[0].type).toBe('test');
        });

        it('should serialize promise dependencies', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<string>();

            pause();

            // Make promise1 depend on promise2
            promise1.dependsOn(promise2);

            const serialized = ResumablePromise.serialize_all([promise1]);

            // Both promises should be in the serialized output
            expect(serialized.length).toEqual(2);
        });

        it('should only serialize promises with side effects or dependencies', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<number>();

            pause();

            // Mark promise2 as side-effect free
            promise2.serialize = function (ctx: any): any {
                ctx.set_type('test');
                ctx.side_effects(false);
                return { test: true };
            };

            const serialized = ResumablePromise.serialize_all([promise1]);

            // Only promise1 should be serialized (has side effects)
            expect(serialized.length).toBeGreaterThan(0);
        });

        it('should handle serialization errors gracefully', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<number>();

            pause();

            // Make serialization throw
            promise1.serialize = function (ctx) {
                ctx.set_type('test');
                throw new Error('Serialization error');
            };

            // Make promise2 depend on promise1
            promise2.dependsOn(promise1);

            const serialized = ResumablePromise.serialize_all([promise1, promise2]);

            // Should have a settled promise with error
            expect(serialized.length).toEqual(2);
            expect(serialized[1].type).toBe('settled');
        });
    });

    describe('Deserialization', () => {
        it('should resume a simple promise', () => {
            const original = new TestResumablePromise<number>();
            pause();
            const serialized = ResumablePromise.serialize_all([original]);

            mockStore.state = 'active';

            const resumed = ResumablePromise.resumePromises(serialized);
            const resumedPromises = Object.values(resumed);

            expect(resumedPromises.length).toBeGreaterThan(0);
            expect(resumedPromises[0]).toBeInstanceOf(ResumablePromise);
        });

        it('should handle resume errors gracefully', () => {
            const badData = [{
                id: '1',
                type: 'nonexistent',
                dependencies: [],
                data: {}
            }];

            const resumed = ResumablePromise.resumePromises(badData);
            const resumedPromises = Object.values(resumed);

            // Should have created a FailedResume
            expect(resumedPromises.length).toBeGreaterThan(0);
        });

        it('should restore promise dependencies', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<string>();

            pause();

            // Create dependency
            promise1.serialize = function (ctx: any): any {
                ctx.set_type('test');
                ctx.ref(promise2);
                return { test: true };
            };

            mockStore.state = 'active';

            const serialized = ResumablePromise.serialize_all([promise1, promise2]);
            const resumed = ResumablePromise.resumePromises(serialized);

            expect(Object.keys(resumed).length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('SettledPromise', () => {
        it('should create resolved settled promise', async () => {
            const promise = new SettledPromise({ result: 'accept', value: 42 });

            const result = await promise;
            expect(result).toBe(42);
            expect(promise.settled).toBe(true);
            expect(promise.promise_state).toBe('accepted');
        });

        it('should create rejected settled promise with error', async () => {
            const promise = new SettledPromise({ result: 'reject_error', value: 'Error message' });

            await expect(promise).rejects.toThrow('Error message');
            expect(promise.settled).toBe(true);
            expect(promise.promise_state).toBe('rejected');
        });

        it('should create rejected settled promise with raw value', async () => {
            const promise = new SettledPromise({ result: 'reject_raw', value: 'raw error' });

            await expect(promise).rejects.toBe('raw error');
        });

        it('should determine if resumable can suspend', () => {
            const acceptedPromise = new TestResumablePromise<number>((resolve) => resolve(42));
            const rejectedPromise = new TestResumablePromise<number>((_, reject) => reject(new Error('test')));

            // Wait for promises to settle
            return Promise.allSettled([acceptedPromise, rejectedPromise]).then(() => {
                const canSuspendAccepted = SettledPromise.can_suspend(acceptedPromise);
                const canSuspendRejected = SettledPromise.can_suspend(rejectedPromise);

                expect(typeof canSuspendAccepted).toBe('boolean');
                expect(canSuspendRejected).toBe(true); // Errors can always suspend
            });
        });

        it('should convert resumable to settled promise', async () => {
            const original = new TestResumablePromise<number>((resolve) => resolve(42));

            // Wait for it to settle
            await original;

            const settled = SettledPromise.for_resumable(original);

            expect(settled).toBeInstanceOf(SettledPromise);
            const result = await settled;
            expect(result).toBe(42);
        });

        it('should serialize and deserialize', () => {
            const promise1 = new SettledPromise({ result: 'accept', value: 42 });
            const promise2 = new TestResumablePromise<number>();

            pause();
            promise2.dependsOn(promise1);

            const serialized = ResumablePromise.serialize_all([promise1, promise2]);
            const resumed = ResumablePromise.resumePromises(serialized);
            const resumedPromises = Object.values(resumed);

            expect(resumedPromises[0]).toBeInstanceOf(SettledPromise);
        });
    });

    describe('ResumableAllPromise', () => {
        it('should resolve when all promises resolve', async () => {
            const p1 = new SettledPromise({ result: 'accept', value: 1 });
            const p2 = new SettledPromise({ result: 'accept', value: 2 });
            const p3 = new SettledPromise({ result: 'accept', value: 3 });

            const all = ResumablePromise.all([p1 as any, p2 as any, p3 as any]);

            const result = await all;
            expect(result).toEqual([1, 2, 3]);
        });

        it('should reject when any promise rejects', async () => {
            const p1 = new TestResumablePromise();
            const p2 = new TestResumablePromise();
            const p3 = new TestResumablePromise();

            const all = ResumablePromise.all([p1 as any, p2 as any, p3 as any]);

            p3['reject'](new Error('error'));

            await expect(all).rejects.toThrow('error');
        });

        it('should handle non-promise values', async () => {
            const all = ResumableAllPromise.create([1, 2, 3]);

            const result = await all;
            expect(result).toEqual([1, 2, 3]);
        });

        it('should serialize and deserialize', () => {
            const p1 = new TestResumablePromise<number>();
            const p2 = new TestResumablePromise<number>();

            const all = ResumablePromise.all([p1 as any, p2 as any]);
            const p3 = new TestResumablePromise<number>();
            p3.dependsOn(all);

            pause();

            const serialized = ResumablePromise.serialize_all([p3]);
            const resumed = ResumablePromise.resumePromises(serialized);
            const resumedPromises = Object.values(resumed);

            expect(resumedPromises.some(p => p instanceof ResumableAllPromise)).toBe(true);
        });

        it('should report awaiting_for correctly', () => {
            const p1 = new SettledPromise({ result: 'accept', value: 1 });
            const p2 = new SettledPromise({ result: 'accept', value: 2 });

            const all = new ResumableAllPromise([p1, p2]);

            const awaitingFor = Array.from((all as any).awaiting_for());
            expect(awaitingFor).toContain(p1);
            expect(awaitingFor).toContain(p2);
        });
    });

    describe('ResumableAllSettledPromise', () => {
        it('should resolve with all results', async () => {
            const p1 = new SettledPromise({ result: 'accept', value: 1 });
            const p2 = new SettledPromise({ result: 'reject_error', value: 'error' });
            const p3 = new SettledPromise({ result: 'accept', value: 3 });

            const allSettled = ResumablePromise.allSettled([p1 as any, p2 as any, p3 as any]);

            const results = await allSettled;
            expect(results).toHaveLength(3);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
            expect(results[1]).toEqual({ status: 'rejected', reason: expect.any(Error) });
            expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
        });

        it('should handle non-promise values', async () => {
            const allSettled = ResumableAllSettledPromise.create([1, 2, 3]);

            const results = await allSettled;
            expect(results).toHaveLength(3);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
        });

        it('should serialize and deserialize', () => {
            const p1 = new SettledPromise({ result: 'accept', value: 1 });
            const p2 = new TestResumablePromise<number>();
            const p3 = new TestResumablePromise<number>();

            const allSettled = ResumablePromise.allSettled([p1 as any, p2 as any]);
            p3.dependsOn(allSettled);

            pause();

            const serialized = ResumablePromise.serialize_all([p3]);
            const resumed = ResumablePromise.resumePromises(serialized);
            const resumedPromises = Object.values(resumed);

            expect(resumedPromises.some(p => p instanceof ResumableAllSettledPromise)).toBe(true);
        });
    });

    describe('CancellableResumablePromise', () => {
        class TestCancellablePromise extends CancellableResumablePromise<number> {
            cancelled = false;

            protected _cancel(reason?: any) {
                this.cancelled = true;
                super._cancel(reason);
            }

            serialize(ctx: any) {
                ctx.set_type('test_cancellable');
                ctx.side_effects(true);
                return {};
            }
        }

        it('should be cancellable', () => {
            const promise = new TestCancellablePromise();

            expect(promise.isCancellable()).toBe(true);
        });

        it('should cancel successfully', async () => {
            const promise = new TestCancellablePromise();

            promise.cancel('test reason');

            expect(promise.cancelled).toBe(true);
            await expect(promise).rejects.toThrow(PromiseCancelled);
        });

        it('should cancel with custom reason', async () => {
            const promise = new TestCancellablePromise();
            const customReason = new Error('Custom cancellation');

            promise.cancel(customReason);

            await expect(promise).rejects.toBe(customReason);
        });

        it('should create PromiseCancelled from string', async () => {
            const promise = new TestCancellablePromise();

            promise.cancel('cancelled');

            await expect(promise).rejects.toThrow(PromiseCancelled);
            await expect(promise).rejects.toThrow('cancelled');
        });

        it('should not cancel non-cancellable promises', () => {
            const promise = new TestResumablePromise<number>();

            expect(() => {
                (promise as any).cancel();
            }).toThrow('Cannot cancel a ResumablePromise that is not cancellable');
        });

        // it('should propagate cancellation to dependencies', () => {
        //     const innerPromise = new TestCancellablePromise();
        //     const outerPromise = new TestCancellablePromise();

        //     // Make outer depend on inner
        //     (outerPromise as any).awaiting_for = function() { return [innerPromise]; };
        //     (innerPromise as any).resumable_awaiters = [outerPromise];

        //     outerPromise.cancel('test');

        //     expect(outerPromise.cancelled).toBe(true);
        //     expect(innerPromise.cancelled).toBe(true);
        // });
    });

    describe('resumableCallbackFactory', () => {
        it('should create callback promises', async () => {
            let callbackCalled = false;
            const factory = resumableCallbackFactory<{ value: number }>(
                'test_callback',
                (state, promise) => {
                    callbackCalled = true;
                    expect(state.value).toBe(42);
                }
            );

            const basePromise = new SettledPromise({ result: 'accept', value: 100 });
            const callbackPromise = factory(basePromise, { value: 42 });

            expect(callbackCalled).toBe(true);
            const result = await callbackPromise;
            expect(result).toBe(100);
        });

        it('should serialize and resume callback promises', () => {
            const factory = resumableCallbackFactory<{ value: number }>(
                'test_callback2',
                (state, promise) => {
                    // Callback logic
                }
            );

            const basePromise = new SettledPromise({ result: 'accept', value: 100 });
            const callbackPromise = factory(basePromise, { value: 42 });

            pause();

            const serialized = ResumablePromise.serialize_all([callbackPromise]);
            const resumed = ResumablePromise.resumePromises(serialized);

            expect(Object.keys(resumed).length).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle circular dependencies', () => {
            const promise1 = new TestResumablePromise<number>();
            const promise2 = new TestResumablePromise<number>();

            // Create circular dependency
            (promise1 as any).resumable_awaiters = [promise2];
            (promise2 as any).resumable_awaiters = [promise1];

            // Should not throw or hang
            const tree = (promise1 as any).full_tree();
            expect(tree.has(promise1)).toBe(true);
            expect(tree.has(promise2)).toBe(true);
        });

        it('should handle empty promise array', () => {
            const serialized = ResumablePromise.serialize_all([]);

            expect(serialized).toEqual([]);
        });

        it('should handle promises that settle during serialization', async () => {
            const promise = new TestResumablePromise<number>((resolve) => {
                setTimeout(() => resolve(42), 10);
            });

            pause();

            const serialized = ResumablePromise.serialize_all([promise]);

            expect(serialized.length).toBeGreaterThan(0);
        });

        it('should track unsuspended promises', () => {
            const promise = new TestResumablePromise<number>();

            mockStore.state = 'suspending';
            promise.compute_paused();
            expect(promise.suspended).toBe(true);

            mockStore.state = 'active';
            promise.compute_paused();
            expect(promise.suspended).toBe(false);
        });
    });
});
