
import * as babel from "@babel/core"
import regenerator from './resumable_transformer'
import { ResumablePromise, Suspend } from "./resumable_promise"

const BABEL_CONFIG: babel.TransformOptions = {
    targets: {
        esmodules: true,
        node: "current",
    },
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
        ['@babel/preset-typescript'],
    ],
    plugins: [
        'babel-plugin-macros',
        ["@babel/plugin-proposal-decorators", { version: "2022-03" }],
        // regenerator,
    ],
}

export class Application {
    constructor(readonly app_id: string, readonly app_root: string) {

    }

    private resumeStoredPromises() {

    }

    async start() {
        await this.compile();
    }

    async serve() {

    }

    async compile() {
        const transpiled = await babel.transformFileAsync("transpile_test.ts", {
            ...BABEL_CONFIG,
        })
        console.log(transpiled.code)
    }

    async watch_files() {

    }

    private _shutdownRequested = false;
    private nonSuspendableGraceReached = false
    get shutdownRequested() { return this._shutdownRequested }

    private suspendedResumables = [];
    private onNonSuspendableClear: () => void;

    protected running_resumables = new Set<ResumablePromise<any>>();
    trackResumablePromise(promise: ResumablePromise<any>) {
        this.running_resumables.add(promise);

        promise.catch(
            (err) => {
                if (err instanceof Suspend) {
                    this.suspendedResumables.push(promise);
                }
                throw err;
            },
            true
        ).finally(() => {
            this.running_resumables.delete(promise);
            this.checkAllPromisesSuspendable();
        })

        if (this.shutdownRequested && this.nonSuspendableGraceReached) {
            promise.suspend();
        }
    }

    private checkAllPromisesSuspendable() {
        if (!this.shutdownRequested) return;
        for (let p of this.running_resumables) {
            if (!p.can_suspend()) return;
        }

        // All promises suspendable!
        this.onNonSuspendableClear();
    }

    private async doShutdown() {
        // Wait up to 15s for pending non-suspendable HA await conditions to resolve
        await new Promise((accept) => {
            const timer = setTimeout(accept, 15000);
            this.onNonSuspendableClear = () => {
                clearTimeout(timer);
                accept(null);
            }
        });

        this.nonSuspendableGraceReached = true;

        // Throw Suspend to all pending suspendable HA await conditions
        for (let task of this.running_resumables) {
            task.suspend();
        }

        /* Edge Case: Deferred awaiting
        {
            const x = some_promise();
            await some_resumable_promise();
            await SomePromise;
        }

        Line 2 should be recognized as not Suspendable.
        Case is solved - x is not serializable
        */

        // TODO Assert all items are suspended (promise rejected) by now
    }

    requestShutdown() {
        this._shutdownRequested = true;
        this.doShutdown();
    }
}
