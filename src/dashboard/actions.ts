import type { ActionName, ActionParams, ActionResult } from "./protocol";

export type ActionHandler<N extends ActionName = ActionName> = (params: ActionParams<N>) => ActionResult<N> | Promise<ActionResult<N>>;

/** Every action param is a string; this lists them per action (exhaustive, so a new `ActionMap` entry must declare its params) */
const ACTION_PARAMS: { [N in ActionName]: ReadonlyArray<keyof ActionParams<N>> } = {
    'app.restart': ['id'],
    'app.stop': ['id'],
    'app.start': ['id'],
    'orphan.cleanup': ['id'],
    'plugin.reconnect': ['id'],
    'entity.delete': ['app', 'key'],
    'storage.delete': ['app', 'key'],
    'sharedStorage.value': ['store', 'key'],
    'storage.value': ['app', 'key'],
    'resumable.cancel': ['app', 'key'],
    'resumable.discard': ['app', 'key'],
    'script.cancel': ['app', 'script', 'run'],
    'crossCall.cancel': ['uuid'],
};

/** Throws unless `params` (untrusted, from the socket) is an object with a string for each param the action takes */
export function validateActionParams<N extends ActionName>(name: N, params: unknown): ActionParams<N> {
    const bad = !params || typeof params !== 'object' ? 'expected an object'
        : (ACTION_PARAMS[name] as string[]).filter(k => typeof (params as any)[k] !== 'string').map(k => `${k} must be a string`).join(', ');
    if (bad) throw new Error(`Invalid params for ${name}: ${bad}`);
    return params as ActionParams<N>;
}

/** Server side of the dashboard's request/response commands (restart an app, ...). Typed by `ActionMap` in ./protocol.ts. */
export class ActionRegistry {
    private handlers = new Map<string, ActionHandler<any>>();

    register<N extends ActionName>(name: N, handler: ActionHandler<N>): () => void {
        if (this.handlers.has(name)) throw new Error(`Dashboard action already registered: ${name}`);
        const wrapped: ActionHandler<any> = params => handler(validateActionParams(name, params));
        this.handlers.set(name, wrapped);
        return () => { if (this.handlers.get(name) === wrapped) this.handlers.delete(name) };
    }

    get(name: string): ActionHandler<any> | undefined {
        return this.handlers.get(name);
    }
}
