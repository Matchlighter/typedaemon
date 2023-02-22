
import { PluginType } from "../hypervisor/config_plugin";
import { BaseInstanceClient, HyperWrapper } from "../hypervisor/managed_apps";
import { PluginInstance } from "./plugin";

export class Plugin<C = any> extends BaseInstanceClient<PluginInstance> {
    get config() {
        return this[HyperWrapper].options as any as PluginType['base'] & C;
    }
}
