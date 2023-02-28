
import { PluginType } from "../hypervisor/config_plugin";
import { current } from "../hypervisor/current";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { PluginInstance } from "../hypervisor/plugin_instance";
import { Application } from "../runtime/application";
import { get_plugin } from "../runtime/hooks";

function isDecContext(thing): thing is DecoratorContext {
    return typeof thing == "object" && typeof thing.kind == 'string' && thing.addInitializer
}

export type Annotable = Application;

const PluginAnnotationsSymbol = Symbol("PluginAnnotations")

export function pluginGetterFactory<T extends Plugin>(pid: string | T, default_id: string) {
    if (pid instanceof Plugin) return () => pid;

    if (pid == default_id) {
        return () => {
            const pl = get_plugin<T>(pid);
            if (!pl) current.application.logMessage("warn", `Attempted to use default MQTT plugin, but it is not configured!`)
            return pl;
        }
    }

    return () => get_plugin<T>(pid);
}

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
        return this[HyperWrapper].options as any as PluginType['base'] & C;
    }
}
