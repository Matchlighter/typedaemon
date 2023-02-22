import chalk = require("chalk");

import { colorLogLevel } from "../common/util";
import { ConsoleMethod } from "../hypervisor/vm";
import { BaseInstance } from "../hypervisor/managed_apps";
import { PluginConfiguration } from "../hypervisor/config_plugin";
import { LifecycleHelper } from "../common/lifecycle_helper";
import { PLUGIN_TYPES } from "../plugins";
import { Plugin } from "../plugins/base";

export class PluginInstance extends BaseInstance<PluginConfiguration> {
    logMessage(level: ConsoleMethod | 'system' | 'lifecycle', ...rest) {
        console.log(chalk`{blueBright [Plugin: ${this.id}]} - ${colorLogLevel(level)} -`, ...rest);
    }

    private _instance: Plugin;
    get instance() { return this._instance }

    readonly cleanupTasks = new LifecycleHelper();

    async _start() {
        this.transitionState("starting");

        const PluginClass = PLUGIN_TYPES[this.options.type];
        this._instance = new PluginClass(this);

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const disposer = this.hypervisor.watchConfigEntry<Plugin>(`plugins.${this.id}`, async (ncfg, ocfg) => {
                if (this.state != 'started') return;
                this.namespace.reinitializeInstance(this);
            });
            this.cleanupTasks.mark(disposer);
        }

        await this.instance?.initialize();

        this.transitionState('started');
    }

    async _shutdown() {
        this.transitionState('stopping')
        await this.instance?.shutdown();
        this.cleanupTasks.cleanup();
        this.transitionState('stopped')
    }
}
