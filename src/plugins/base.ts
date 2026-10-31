
import { TypedEmitter } from "tiny-typed-emitter";
import { Constructor } from "type-fest";

import { LifecycleHelper } from "../common/lifecycle_helper";
import type { PluginConnectionState } from "../common/shared_types";
import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { BasePluginConfig } from "../hypervisor/config_plugin";
import { current } from "../hypervisor/current";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { PluginInstance } from "../hypervisor/plugin_instance";
import { Application } from "../runtime/application";
import { getOrMakeMapEntry } from "../util";

function isDecContext(thing): thing is DecoratorContext {
    return typeof thing == "object" && typeof thing.kind == 'string' && thing.addInitializer
}

export type Annotable = Application;

const PluginAnnotationsSymbol = Symbol("PluginAnnotations")

/**
 * Retrieve the plugin instance for the given Plugin id
 */
export const get_plugin = <T = Plugin>(identifier: string): T => {
    current.application?.usedPlugins.add(identifier);
    return current.hypervisor.getPlugin(identifier)?.instance as any;
}

/**
 * Add an annotation to the target application class (or Decorator Context).
 * The annotation will be called when the application is started.
 */
export function notePluginAnnotation(target: any, annotation: (self: Annotable) => void) {
    if (isDecContext(target)) {
        target.addInitializer(function () {
            notePluginAnnotation(this, annotation);
        })
    } else {
        target[PluginAnnotationsSymbol] ||= [];
        target[PluginAnnotationsSymbol].push(annotation);
    }
}

export function pluginAnnotationDecorator<T extends ClassMemberDecoratorContext>(f: (context: T, self) => any): (thing, context: T) => void {
    return (thing, context: T) => {
        notePluginAnnotation(context, function () {
            f.call(this, context, this);
        });
    }
}

export async function flushPluginAnnotations(self: any) {
    for (let anno of self[PluginAnnotationsSymbol] || []) {
        await anno.call(self, self)
    }
}

export type { PluginConnectionState };

export abstract class Plugin<C = any> extends BaseInstanceClient<PluginInstance> {
    abstract configuration_updated(new_config: C, old_config: C);

    /** Drop and re-establish the plugin's link. Throws when the plugin has no link or cannot reconnect (the default) */
    reconnect(): void | Promise<void> {
        throw new Error('This plugin does not support reconnecting');
    }

    /** Fires (no arguments) when `connectionState`, `connectionTarget` or `statusSummary` may have changed */
    readonly connectionEvents = new TypedEmitter<{ change: () => void }>();

    /** Live link state; undefined for plugins without a link (or while there is nothing to measure) */
    get connectionState(): PluginConnectionState | undefined { return undefined }

    /** What the plugin connects to / listens on, for display */
    get connectionTarget(): string | undefined { return undefined }

    /** One status line for the dashboard (eg `{ label: 'Routes', value: '2 routes' }`); undefined when there is nothing to say. Call `connectionChanged()` when it changes */
    get statusSummary(): { label: string; value: string }[] | undefined { return undefined }

    protected connectionChanged() { this.connectionEvents.emit('change') }

    get config() {
        return this[HyperWrapper].options as any as BasePluginConfig & C;
    }

    getAPI<T>(): T {
        // TODO Make abstract
        // @ts-ignore
        return this.api;
    }

    protected addCleanup(cleaner: Parameters<LifecycleHelper['append']>[0]) {
        this[HyperWrapper].cleanups.append(() => this[HyperWrapper].invoke(cleaner));
    }
}

export interface ApiFactory<P extends Plugin = any> {
    (plugin_instace: P): any;
    defaultPluginId: string;
}

export function bind_callback_env<T extends (...args: any[]) => any>(callback: T): T {
    const app = current.application;
    return ((...args: Parameters<T>) => {
        return app.invoke(callback, ...args)
    }) as any
}

class NoApplicationError extends Error { }
export function assert_application_context() {
    if (!current.application) throw new NoApplicationError("Method can only be called from an Application. If it was, a callback was likely called without invoke()")
}

export function handle_client_error(ex: any) {
    if (current.application) {
        current.application?.logClientMessage("error", ex);
    } else {
        console.error(ex)
    }
}

export function client_call_safe<P extends any[]>(mthd: (...params: P) => any, ...params: P) {
    try {
        return mthd(...params);
    } catch (ex) {
        handle_client_error(ex);
    }
}

export type DefaultApiExport<F extends ApiFactory> = ReturnType<F> & {

}

export class PluginNotStartedError extends Error {
    constructor(readonly plugin_id: string) {
        super(`Plugin '${plugin_id}' not started`)
    }
}
export class NoSuchPluginError extends Error {
    constructor(readonly plugin_id: string) {
        super(`No such plugin '${plugin_id}'`)
    }
}

export function makeApiExport<F extends ApiFactory<any>>(factory: F): DefaultApiExport<F> {
    const base = {};
    Object.preventExtensions(base);
    return new Proxy(base, {
        get(target, p, receiver) {
            const pl = get_plugin<Plugin>(factory.defaultPluginId);
            if (!pl) current.application.logMessage("warn", `Attempted to use default ${factory.defaultPluginId} plugin, but it is not configured!`);
            if (pl[HyperWrapper].state != "started") throw new PluginNotStartedError(factory.defaultPluginId);
            const api = pl.getAPI() as any;
            return Reflect.get(api, p, api);
        }
    }) as any;
}

type StoresByType<T = any> = Map<Constructor<T>, T>
type PluginStores = WeakMap<PluginInstance, StoresByType>
type AppPluginStores = WeakMap<ApplicationInstance, PluginStores>

const LocalDatas: AppPluginStores = new WeakMap();

/** Like `getOrCreateLocalData`, but never creates */
export function peekLocalData<T>(plugin: Plugin, app: ApplicationInstance, key: any): T | undefined {
    return LocalDatas.get(app)?.get(plugin[HyperWrapper])?.get(key);
}

export function getOrCreateLocalData<T, P extends Plugin>(plugin: P, app: ApplicationInstance, key: any, builder: (plugin: P, app: ApplicationInstance) => T): T {
    const app_data = getOrMakeMapEntry(LocalDatas, app, () => new WeakMap());
    const plugin_data = getOrMakeMapEntry(app_data, plugin[HyperWrapper], () => new Map());
    const data = getOrMakeMapEntry(plugin_data, key, () => builder(plugin, app))

    return data;
}
