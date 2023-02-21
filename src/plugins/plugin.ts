import { ApplicationInstance } from "../hypervisor/application";
import { Application } from "../runtime/application";

export class Plugin<C = any> extends Application<C> {

}

export class PluginInstance extends ApplicationInstance {
    get instance(): Plugin {
        return super.instance;
    }
}
