import path = require("path");
import chalk = require("chalk");
import deepEqual = require("deep-eql");

import { BaseInstance, InstanceLogConfig } from "../hypervisor/managed_apps";
import { PluginConfiguration } from "../hypervisor/config_plugin";
import { PLUGIN_TYPES } from "../plugins";
import { Plugin } from "../plugins/base";
import { configChangeHandler } from "./managed_config_events";

export class PluginInstance extends BaseInstance<PluginConfiguration, Plugin> {
    protected loggerOptions(): InstanceLogConfig {
        const lopts = this.options.logging;
        const file = lopts.file && path.resolve(this.hypervisor.working_directory, lopts.file);
        return {
            tag: chalk.blueBright`Plugin: ${this.id}`,
            manager: { file, level: lopts?.level },
            user: { file, level: lopts?.level },
        }
    }

    async _start() {
        this.transitionState("starting");

        const PluginClass = PLUGIN_TYPES[this.options.type];
        this._instance = new PluginClass(this);

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const handler = configChangeHandler(this, async ({ handle }) => {
                handle("logging", () => this._updateLogConfig())
            });
            const disposer = this.hypervisor.watchConfigEntry<PluginConfiguration>(`plugins.${this.id}`, handler);
            this.cleanups.append(disposer);
        }

        this.cleanups.append(() => this.instance.shutdown?.());
        await this.instance?.initialize();

        this.transitionState('started');
    }
}
