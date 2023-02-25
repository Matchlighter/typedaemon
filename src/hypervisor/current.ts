import { ApplicationInstance } from "./application_instance";
import { BaseInstance, CurrentInstanceStack } from "./managed_apps";
import { PluginInstance } from "./plugin_instance";

export const current = {
    get applicationStack() { return CurrentInstanceStack.getStore() },
    get instance() {
        const stack = current.applicationStack || [];
        return stack[stack.length - 1];
    },
    get application() {
        return current.stackItem(inst => inst instanceof ApplicationInstance) as ApplicationInstance;
    },
    get plugin() {
        return current.stackItem(inst => inst instanceof PluginInstance) as PluginInstance;
    },
    get hypervisor() {
        return current.instance?.hypervisor;
    },
    stackItem(filter: (inst: BaseInstance<any, any, any>) => boolean) {
        const stack = current.applicationStack || [];
        for (let i = stack.length - 1; i >= 0; i--) {
            if (filter(stack[i])) return stack[i];
        }
        return null;
    },
}
