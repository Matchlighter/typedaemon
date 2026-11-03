import "./mock_hypervisor";

import * as babel from "@babel/core";
import * as fs from "fs";

import { APP_BABEL_CONFIG } from "../../src/app_transformer";
import * as regen_executor from "../../src/runtime/regen_executor";
import * as resumable_runtime from "../../src/runtime/resumable";
import { ResumablePromise, SerializeContext } from "../../src/runtime/resumable/resumable_promise";
import { ResumableStore, type SaveResult } from "../../src/runtime/resumable/resumable_store";
import { useTempDir } from "./fs";

process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true";

const COMPILE_MODULES: Record<string, any> = {
    "typedaemon": resumable_runtime,
    "typedaemon/runtime/regen_executor": regen_executor,
};

/**
 * Compile app-style source through the same Babel pipeline as real apps (so `@resumable` methods
 * get the regenerator transform) and evaluate it, returning its exports. `globals` are exposed to the source as free variables.
 */
export function compileApp<T = any>(source: string, globals: Record<string, any> = {}, extraModules: Record<string, any> = {}): T {
    const out = babel.transformSync(source, {
        ...APP_BABEL_CONFIG,
        filename: "/virtual/app.ts",
        sourceMaps: false,
    });

    const module = { exports: {} as any };
    const modules = { ...COMPILE_MODULES, ...extraModules };
    const req = (name: string) => {
        if (!(name in modules)) throw new Error(`compileApp: unexpected import "${name}"`);
        return modules[name];
    };
    const gnames = Object.keys(globals);
    new Function("require", "module", "exports", ...gnames, out.code)(req, module, module.exports, ...gnames.map(k => globals[k]));
    return module.exports;
}

/**
 * Controllable ResumablePromise. Survives serialization by `key`; resumed instances are discoverable via `Deferred.get(key)`
 */
export class Deferred<T = any> extends ResumablePromise<T> {
    private static live = new Map<string, Deferred>();

    static get<T = any>(key: string) {
        return this.live.get(key) as Deferred<T>;
    }

    static reset() {
        this.live.clear();
    }

    constructor(readonly key: string, readonly sideeffects = false) {
        super();
        Deferred.live.set(key, this);
    }

    static {
        ResumablePromise.defineClass<Deferred<any>>({
            type: "test:deferred",
            resumer: (data) => new this(data.key, data.sideeffects),
        })
    }

    resolve(value: T) {
        return super.resolve(value);
    }

    reject(reason: any) {
        return super.reject(reason);
    }

    serialize(ctx: SerializeContext) {
        ctx.set_type("test:deferred");
        ctx.side_effects(this.sideeffects);
        return { key: this.key, sideeffects: this.sideeffects };
    }
}

/** Let pending promise callbacks run */
export const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Harness emulating an app lifecycle around a real ResumableStore: start a "run", shut it down (suspending and
 * persisting Resumables to disk) and boot a new run that resumes them.
 *
 * Use via `useResumableHarness()`.
 */
export class ResumableHarness {
    file: string;
    store: ResumableStore;
    /** What the last \`shutdown()\` reported */
    lastSave: SaveResult;
    private original_get_store: typeof ResumablePromise.get_store;

    setup(file: string) {
        this.file = file;
        this.original_get_store = ResumablePromise.get_store;
        ResumablePromise.get_store = () => this.store;
    }

    teardown() {
        ResumablePromise.get_store = this.original_get_store;
        this.store = null;
        Deferred.reset();
    }

    /** Begin a new run with a fresh store. `owners` maps registered owner ids to their (new) instances */
    async boot(owners: Record<string, any> = {}) {
        for (let [id, owner] of Object.entries(owners)) {
            resumable_runtime.resumable.register_context(id, owner, true);
        }
        this.store = new ResumableStore({ file: this.file }, owners);
        await this.store.load();
        return this.store;
    }

    /** Suspend and persist the current run, returning what was written to disk (if anything) */
    async shutdown() {
        this.lastSave = await this.store.save();
        return this.persisted();
    }

    persisted() {
        if (!fs.existsSync(this.file)) return null;
        return JSON.parse(fs.readFileSync(this.file).toString());
    }
}

/** Provide a ResumableHarness, reset for each test in the enclosing `describe` */
export function useResumableHarness() {
    const tmp = useTempDir("td-resumable-");
    const harness = new ResumableHarness();

    beforeEach(() => {
        harness.setup(tmp.path("resumables.json"));
    });

    afterEach(() => {
        harness.teardown();
    });

    return harness;
}
