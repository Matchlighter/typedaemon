
import { Constructor } from "type-fest";

import { LifecycleHelper } from "../common/lifecycle_helper";
import { ApplicationInstance } from "../hypervisor/application_instance";
import { BasePluginConfig } from "../hypervisor/config_plugin";
import { current } from "../hypervisor/current";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { PluginInstance } from "../hypervisor/plugin_instance";
import { Application } from "../runtime/application";

function isDecContext(thing): thing is DecoratorContext {
    return typeof thing == "object" && typeof thing.kind == 'string' && thing.addInitializer
}

export type Annotable = Application;

const PluginAnnotationsSymbol = Symbol("PluginAnnotations")

/**
 * Retrieve the plugin instance for the given Plugin id
 */
export const get_plugin = <T>(identifier: string): T => {
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

export abstract class Plugin<C = any> extends BaseInstanceClient<PluginInstance> {
    abstract configuration_updated(new_config: C, old_config: C);

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

class NoApplicationError extends Error {}
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

export function makeApiExport<F extends ApiFactory<any>>(factory: F): DefaultApiExport<F> {
    const base = {};
    Object.preventExtensions(base);
    return new Proxy(base, {
        get(target, p, receiver) {
            const pl = get_plugin<Plugin>(factory.defaultPluginId);
            if (!pl) current.application.logMessage("warn", `Attempted to use default ${factory.defaultPluginId} plugin, but it is not configured!`)
            const api = pl.getAPI() as any;
            return Reflect.get(api, p, api);
        }
    }) as any;
}

type StoresByType<T = any> = Map<Constructor<T>, T>
type PluginStores = WeakMap<PluginInstance, StoresByType>
type AppPluginStores = WeakMap<ApplicationInstance, PluginStores>

const LocalDatas: AppPluginStores = new WeakMap();

function getOrMakeEntry<K extends object, V>(map: Map<K, V> | WeakMap<K, V>, key: K, builder: () => V) {
    if (!map.has(key)) {
        map.set(key, builder());
    }
    return map.get(key);
}

export function getOrCreateLocalData<T, P extends Plugin>(plugin: P, app: ApplicationInstance, key: any, builder: (plugin: P, app: ApplicationInstance) => T): T {
    const app_data = getOrMakeEntry(LocalDatas, app, () => new WeakMap());
    const plugin_data = getOrMakeEntry(app_data, plugin[HyperWrapper], () => new Map());
    const data = getOrMakeEntry(plugin_data, key, () => builder(plugin, app))

    return data;
}
