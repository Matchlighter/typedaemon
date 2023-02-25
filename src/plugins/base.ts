
import { PluginType } from "../hypervisor/config_plugin";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { PluginInstance } from "../hypervisor/plugin_instance";

function isDecContext(thing): thing is DecoratorContext {
    return typeof thing == "object" && typeof thing.kind == 'string' && thing.addInitializer
}

const PluginAnnotationsSymbol = Symbol("PluginAnnotations")

// TODO Add App setup step to process these annotations
export function notePluginAnnotation(target: any, annotation) {
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


export abstract class Plugin<C = any> extends BaseInstanceClient<PluginInstance> {
    abstract configuration_updated(new_config: C, old_config: C);

    get config() {
        return this[HyperWrapper].options as any as PluginType['base'] & C;
    }
}
