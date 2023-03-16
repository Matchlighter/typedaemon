
import { NodeVM } from 'vm2';
import path = require('path');
import chalk = require('chalk');
import deepEqual = require('deep-eql');
import fs = require('fs');
import execa = require('execa');
import extract_comments = require('extract-comments');
import { AsyncReturnType } from 'type-fest';

import { debounce } from "@matchlighter/common_library/limit"

import { AppConfiguration } from "./config_app";
import { ResumableStore } from '../runtime/resumable';
import { Application } from '../runtime/application';
import { PersistentStorage } from './persistent_storage';
import { createApplicationVM } from './vm';
import { TYPEDAEMON_PATH, fileExists, trim, watchFile } from '../common/util';
import { BaseInstance, InstanceLogConfig } from './managed_apps';
import { RequireRestart, configChangeHandler } from './managed_config_events';
import { flushPluginAnnotations } from '../plugins/base';
import { resumable } from '../runtime/resumable';
import { installDependencies } from './packages';

export interface ApplicationMetadata {
    applicationClass?: typeof Application;
    dependencies?: any;
}

export type AppLifecycle = 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

export type MyConditionalKeys<Base, Condition> = {
    [Key in keyof Base]: Base[Key] extends Condition ? Base[Key] : never;
};

export class ApplicationInstance extends BaseInstance<AppConfiguration, Application, {}> {
    get app_config() {
        return this.options.config;
    }

    get entrypoint() {
        return path.resolve(this.hypervisor.working_directory, this.options.source)
    }

    readonly resumableStore = new ResumableStore();
    readonly persistedStorage: PersistentStorage = new PersistentStorage();

    protected loggerOptions(): InstanceLogConfig {
        const lopts = this.options.logging;
        let file = lopts?.file;

        if (!file) {
            file = this.isThickApp ? path.join(this.operating_directory, "application.log") : lopts._thin_app_file;
        }

        file = path.resolve(this.hypervisor.working_directory, file);

        return {
            tag: chalk.blue`Application: ${this.id}`,
            manager: { file: file, level: lopts?.system_level },
            user: { file: file, level: lopts?.level },
        }
    }

    includedFileScope(file: string) {
        if (!file) return "sandbox";

        // Make sure TypeDaemon stuff always runs on the Host
        if (file.includes(TYPEDAEMON_PATH)) {
            return "host";
        }

        // _Any_ files in the app directory should run in the Sandbox
        if (file.includes(this.source_directory)) {
            return "sandbox";
        }

        // In fact, any files in the appications directory should run in the Sandbox
        if (file.includes(path.resolve(this.hypervisor.working_directory, 'applications'))) {
            return "sandbox";
        }

        // Any Lite-App Environments should run in the Sandbox
        if (file.includes(path.resolve(this.hypervisor.operations_directory, "app_environments"))) {
            return "sandbox";
        }

        // TODO If hosted_module, "host"
        // TODO If global dependency, "host"

        if (file.match(/node_modules/)) {
            return "host"
        }

        return "sandbox";
    }

    private watchedDependencies = new Set<string>();
    markFileDependency(file: string, calling_module?: string) {
        if (!this.options.watch?.source) return;
        if (this.includedFileScope(file) != "sandbox") return;
        if (file.includes("/node_modules/")) return;

        // Don't watch the new file if it was somehow hopped to
        // if (calling_module && !this.watchedDependencies.has(calling_module)) return;

        if (file == this.entrypoint) {
            this.logMessage("debug", `Watching entrypoint file (${chalk.green(file)}) for changes`);
        } else {
            this.logMessage("debug", `Noticed dependency on ${chalk.green(file)}, watching for changes`);
        }

        const watcher = watchFile(file, () => {
            this.restartAfterSourceChange();
        });
        this.watchedDependencies.add(file);

        this.cleanups.append(() => {
            watcher.close()
            this.watchedDependencies.delete(file);
        });
    }

    @debounce({ timeToStability: 2000 })
    private restartAfterSourceChange() {
        this.logMessage("info", `Source dependency updated. Restarting`)
        this.namespace.reinitializeInstance(this);
    }

    async _start() {
        if (!await fileExists(this.entrypoint)) {
            throw new Error(`Application entrypoint '${this.entrypoint}' not found`)
        }

        await fs.promises.mkdir(this.operating_directory, { recursive: true });

        this.markFileDependency(this.entrypoint);

        const moduleSource = (await fs.promises.readFile(this.entrypoint)).toString();

        this.logMessage("debug", `Parsing package dependencies`);
        const { dependencies } = parseAnnotations(moduleSource);

        // Items in the config override any that are in the source
        Object.assign(dependencies, this.options.dependencies || {});

        const packageFilePath = path.join(this.operating_directory, "package.json");
        let packageJson: any = {};
        let shouldManagePackage = !await fileExists(packageFilePath);
        if (!shouldManagePackage) {
            packageJson = JSON.parse((await fs.promises.readFile(packageFilePath)).toString());
            if (packageJson['typedaemon_managed']) {
                shouldManagePackage = true;
            } else if (Object.keys(dependencies).length > 0) {
                this.logMessage("warn", `Source file includes dependency annotations, but a non-managed package.json file was found. In-file dependency annoations will be ignored.`)
            }
        }

        if (shouldManagePackage) {
            this.logMessage("debug", `Generating managed package.json`);
            // TODO Do not install items that are available in the Host
            packageJson = this.generateOpPackageJson({ dependencies });
            await fs.promises.writeFile(packageFilePath, JSON.stringify(packageJson));
        }

        // if (Object.keys(packageJson?.dependencies || {}).length > 0) {
        this.logMessage("info", `Installing packages`);
        await installDependencies({
            dir: this.operating_directory,
            logger: (...args) => this.logMessage("debug", ...args),
            lockfile: this.isThickApp,
            devPackages: true,
        });

        this.transitionState("compiling");

        const module = await this.compileModule();
        this.cleanups.append(() => this._vm.removeAllListeners?.());
        const mainExport = module[this.options.export || 'default'];
        const metadata: ApplicationMetadata = (typeof mainExport == 'object' && mainExport) || mainExport.metadata || module.metadata || { applicationClass: mainExport, ...module, ...mainExport };

        this.transitionState("starting")

        const AppClass = metadata.applicationClass;
        this._instance = new AppClass(this);

        resumable.register_context("APPLICATION", this._instance, true);

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const handler = configChangeHandler(this, async ({ handle, ncfg, ocfg }) => {
                if (!deepEqual(immutableConfigBits(ocfg), immutableConfigBits(ncfg))) {
                    this.logMessage("debug", `Configuration changed significantly, restarting`);
                    throw new RequireRestart()
                }

                handle("logging", () => this._updateLogConfig())
            });
            const disposer = this.hypervisor.watchConfigEntry<AppConfiguration>(`apps.${this.id}`, handler);
            this.cleanups.append(disposer);
        }

        const state_file = path.join(this.operating_directory, ".resumable_state.json");

        // We want this to run _after_ the userspace app has completely shutdown
        this.cleanups.append(async () => {
            this.logMessage("info", "Suspending Resumables")
            const suspendeds = await this.resumableStore.suspendAndStore({
                log: (...args) => this.logMessage(...args),
            });
            if (suspendeds.length > 0) {
                await fs.promises.writeFile(state_file, JSON.stringify(suspendeds));
            }
        });

        try {
            await this.invoke(() => this.instance.initialize?.());
        } catch (ex) {
            this.invoke(() => {
                this.logClientMessage("error", `Failed while starting up: `, ex)
            })
            return
        } finally {
            this.cleanups.append(() => this.invoke(() => this.instance.shutdown?.()));
        }

        await this.invoke(async () => {
            // TODO Skip if initialize already did this
            await flushPluginAnnotations(this.instance);

            if (await fileExists(state_file)) {
                this.logMessage("info", "Found stored Resumables, resuming them")
                const restore_json = await fs.promises.readFile(state_file);
                const restore_list = JSON.parse(restore_json.toString());
                await this.resumableStore.resume(restore_list, {
                    "APPLICATION": this._instance,
                });
                await fs.promises.unlink(state_file)
            }
        })

        this.transitionState('started');
    }

    private generateOpPackageJson({ dependencies }) {
        return {
            "name": this.id,
            "version": "0.0.1",
            "license": "UNLICENSED",
            "typedaemon_managed": true,
            "dependencies": dependencies,
        }
    }

    get isLiteApp() {
        return !this.isThickApp;
    }

    private _isThickApp;
    get isThickApp() {
        if (this._isThickApp == null) {
            this._isThickApp = fs.existsSync(path.join(this.source_directory, 'package.json'));
        }
        return this._isThickApp;
    }

    get operating_directory() {
        const wd = this.hypervisor.working_directory;

        if (this.options.operating_directory) {
            return path.resolve(wd, this.options.operating_directory);
        }

        if (this.isThickApp) {
            return path.dirname(this.entrypoint);
        }

        return path.resolve(this.hypervisor.operations_directory, "app_environments", this.id);
    }

    get source_directory() {
        return path.dirname(this.entrypoint);
    }

    private async compileModule() {
        const vm = await this.vm();
        return vm.runFile(this.entrypoint);
    }

    private _vm: AsyncReturnType<typeof createApplicationVM>;
    private async vm() {
        if (this._vm) return this._vm;
        const vm = await createApplicationVM(this);
        return this._vm = vm;
    }
}

function immutableConfigBits(cfg: AppConfiguration): Partial<AppConfiguration> {
    const immutable = { ...cfg };
    delete immutable.config;
    delete immutable.logging;
    delete immutable.watch;
    return immutable
}

function parseAnnotations(code: string) {
    const dependencies = {}

    const noteDependency = (pkg: string, version: string) => {
        pkg = trim(pkg, /[\s'"]/);
        version = trim(version || '*', /[\s'"]/);
        if (dependencies[pkg] && dependencies[pkg] != version) {
            throw new Error(`A different version of '${pkg}' is already required!`)
        }
        dependencies[pkg] = version;
    }

    for (let comment of extract_comments(code) as { type: string, value: string }[]) {
        if (comment.type != "BlockComment") continue;

        const { value } = comment;

        // @dependencies { package: 0.1.2, package2: 3.4.5 }
        for (let m of value.matchAll(/@dependencies\s*\{(.*)\}/sg)) {
            const items = m[1].trim().split(/[,\n]+/).map(l => l.trim())
            for (let d of items) {
                if (!d) continue;
                const [pkg, version] = d.split(/[ :]+/);
                noteDependency(pkg, version);
            }
        }

        // @dependency package 0.1.2
        for (let m of value.matchAll(/@dependency\s+([\w-_]+)(:|\s+)(.+)\s*$/mg)) {
            noteDependency(m[1], m[3]);
        }
    }

    return { dependencies }
}
