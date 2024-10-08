
export interface AsyncLockOptions {
    Promise?: typeof Promise;

    timeout?: number;
    maxOccupationTime?: number;
    maxExecutionTime?: number;
    maxPending?: number;
}

export class AsyncLock {
    constructor(opts: AsyncLockOptions = {}) {
        this.Promise = opts.Promise || Promise;

        // format: {key : [fn, fn]}
        // queues[key] = null indicates no job running for key
        this.queues = Object.create(null);

        this.timeout = opts.timeout || AsyncLock.DEFAULT_TIMEOUT;
        this.maxOccupationTime = opts.maxOccupationTime || AsyncLock.DEFAULT_MAX_OCCUPATION_TIME;
        this.maxExecutionTime = opts.maxExecutionTime || AsyncLock.DEFAULT_MAX_EXECUTION_TIME;
        if (opts.maxPending === Infinity || (Number.isInteger(opts.maxPending) && opts.maxPending >= 0)) {
            this.maxPending = opts.maxPending;
        } else {
            this.maxPending = AsyncLock.DEFAULT_MAX_PENDING;
        }
    }

    readonly Promise: typeof Promise;

    private queues;
    private timeout
    private maxOccupationTime
    private maxExecutionTime
    private maxPending

    static DEFAULT_TIMEOUT = 0; //Never
    static DEFAULT_MAX_OCCUPATION_TIME = 0; //Never
    static DEFAULT_MAX_EXECUTION_TIME = 0; //Never
    static DEFAULT_MAX_PENDING = 1000;

    /**
     * Acquire Locks
     *
     * @param {String|Array} key 	resource key or keys to lock
     * @param {function} fn 	async function
     * @param {function} cb 	callback function, otherwise will return a promise
     * @param {Object} opts 	options
     */
    acquire(key: string | string[], fn: (arg?) => void, cb?: (err, ret) => void, opts?) {
        if (Array.isArray(key)) {
            return this._acquireBatch(key, fn, cb, opts);
        }

        if (typeof (fn) !== 'function') {
            throw new Error('You must pass a function to execute');
        }

        // faux-deferred promise using new Promise() (as Promise.defer is deprecated)
        var deferredResolve = null;
        var deferredReject = null;
        var deferred = null;

        if (typeof (cb) !== 'function') {
            opts = cb;
            cb = null;

            // will return a promise
            deferred = new this.Promise((resolve, reject) => {
                deferredResolve = resolve;
                deferredReject = reject;
            });
        }

        opts = opts || {};

        var resolved = false;
        var timer = null;
        var occupationTimer = null;
        var executionTimer = null;

        var done = (locked, err?, ret?) => {
            if (occupationTimer) {
                clearTimeout(occupationTimer);
                occupationTimer = null;
            }

            if (executionTimer) {
                clearTimeout(executionTimer);
                executionTimer = null;
            }

            if (locked) {
                if (!!this.queues[key] && this.queues[key].length === 0) {
                    delete this.queues[key];
                }
            }

            if (!resolved) {
                if (!deferred) {
                    if (typeof (cb) === 'function') {
                        cb(err, ret);
                    }
                }
                else {
                    //promise mode
                    if (err) {
                        deferredReject(err);
                    }
                    else {
                        deferredResolve(ret);
                    }
                }
                resolved = true;
            }

            if (locked) {
                //run next func
                if (!!this.queues[key] && this.queues[key].length > 0) {
                    this.queues[key].shift()();
                }
            }
        };

        var exec = (locked) => {
            if (resolved) { // may due to timed out
                return done(locked);
            }

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            var maxExecutionTime = opts.maxExecutionTime || this.maxExecutionTime;
            if (maxExecutionTime) {
                executionTimer = setTimeout(() => {
                    if (!!this.queues[key]) {
                        done(locked, new Error('Maximum execution time is exceeded ' + key));
                    }
                }, maxExecutionTime);
            }

            // Callback mode
            if (fn.length === 1) {
                var called = false;
                try {
                    fn((err, ret) => {
                        if (!called) {
                            called = true;
                            done(locked, err, ret);
                        }
                    });
                } catch (err) {
                    // catching error thrown in user function fn
                    if (!called) {
                        called = true;
                        done(locked, err);
                    }
                }
            }
            else {
                // Promise mode
                this._promiseTry(() => {
                    return fn();
                })
                    .then((ret) => {
                        done(locked, undefined, ret);
                    }, (error) => {
                        done(locked, error);
                    });
            }
        };

        if (!this.queues[key]) {
            this.queues[key] = [];
            exec(true);
        }
        else if (this.queues[key].length >= this.maxPending) {
            done(false, new Error('Too many pending tasks in queue ' + key));
        }
        else {
            var taskFn = () => {
                exec(true);
            };
            if (opts.skipQueue) {
                this.queues[key].unshift(taskFn);
            } else {
                this.queues[key].push(taskFn);
            }

            var timeout = opts.timeout || this.timeout;
            if (timeout) {
                timer = setTimeout(() => {
                    timer = null;
                    done(false, new Error('async-lock timed out in queue ' + key));
                }, timeout);
            }
        }

        var maxOccupationTime = opts.maxOccupationTime || this.maxOccupationTime;
        if (maxOccupationTime) {
            occupationTimer = setTimeout(() => {
                if (!!this.queues[key]) {
                    done(false, new Error('Maximum occupation time is exceeded in queue ' + key));
                }
            }, maxOccupationTime);
        }

        if (deferred) {
            return deferred;
        }
    };

    /*
     * Below is how this function works:
     *
     * Equivalent code:
     * this.acquire(key1, function(cb){
     *     this.acquire(key2, function(cb){
     *         this.acquire(key3, fn, cb);
     *     }, cb);
     * }, cb);
     *
     * Equivalent code:
     * var fn3 = getFn(key3, fn);
     * var fn2 = getFn(key2, fn3);
     * var fn1 = getFn(key1, fn2);
     * fn1(cb);
     */
    _acquireBatch(keys, fn, cb, opts) {
        if (typeof (cb) !== 'function') {
            opts = cb;
            cb = null;
        }

        var getFn = (key, fn) => {
            return (cb) => {
                this.acquire(key, fn, cb, opts);
            };
        };

        var fnx = keys.reduceRight((prev, key) => {
            return getFn(key, prev);
        }, fn);

        if (typeof (cb) === 'function') {
            fnx(cb);
        }
        else {
            return new this.Promise((resolve, reject) => {
                // check for promise mode in case keys is empty array
                if (fnx.length === 1) {
                    fnx((err, ret) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(ret);
                        }
                    });
                } else {
                    resolve(fnx());
                }
            });
        }
    };

    /*
     *	Whether there is any running or pending asyncFunc
     *
     *	@param {String} key
     */
    isBusy(key) {
        if (!key) {
            return Object.keys(this.queues).length > 0;
        }
        else {
            return !!this.queues[key];
        }
    };

    /**
     * Promise.try() implementation to become independent of Q-specific methods
     */
    _promiseTry(fn) {
        try {
            return this.Promise.resolve(fn());
        } catch (e) {
            return this.Promise.reject(e);
        }
    };
}

