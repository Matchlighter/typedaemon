
import { AsyncLocalStorage } from 'async_hooks'
import { NodeVM } from 'vm2';
import path = require('path');
import chalk = require('chalk');
import deepEqual = require('deep-eql');
import fs = require('fs');
import execa = require('execa');
import extract_comments = require('extract-comments');

import { AppConfiguration } from "./config_app";
import { LifecycleHelper } from '../common/lifecycle_helper';
import { ResumableStore } from '../runtime/resumable_store';
import { Application } from '../runtime/application';
import { PersistentStorage } from './persistent_storage';
import { ConsoleMethod, createApplicationVM } from './vm';
import { colorLogLevel, fileExists, trim, watchFile } from '../common/util';
import { debounce } from '../common/limit';
import { BaseInstance } from './managed_apps';

const CurrentAppStore = new AsyncLocalStorage<ApplicationInstance>()

export class RequireRestart extends Error { }
export class FallbackRequireRestart extends RequireRestart { }

export const current = {
    get application() { return CurrentAppStore.getStore() },
    get hypervisor() { return CurrentAppStore.getStore()?.hypervisor },
}

export interface ApplicationMetadata {
    applicationClass?: typeof Application;
    dependencies?: any;
}

const TYPEDAEMON_PATH = path.join(__dirname, '..')

export type AppLifecycle = 'initializing' | 'compiling' | 'starting' | 'started' | 'stopping' | 'stopped' | 'dead';

export class ApplicationInstance extends BaseInstance<AppConfiguration, {}> {
    get app_config() {
        return this.options.config;
    }

    get entrypoint() {
        return path.resolve(this.hypervisor.working_directory, this.options.source)
    }

    readonly cleanupTasks = new LifecycleHelper();
    readonly resumableStore = new ResumableStore();
    readonly persistedStorage: PersistentStorage = new PersistentStorage();

    private _instance: Application;
    get instance() { return this._instance }

    invoke<F extends (...params: any[]) => any>(func: F, ...params: Parameters<F>): ReturnType<F>
    invoke(what: string | symbol, parameters?: any[])
    invoke(what, ...params) {
        if (!what) throw new Error("Must pass a method to invoke");

        if (typeof what == 'function') {
            return CurrentAppStore.run(this, () => {
                return what.call(this.instance, ...params);
            })
        } else {
            return this.invoke(this.instance[what], ...params);
        }
    }

    logMessage(level: ConsoleMethod | 'system' | 'lifecycle', ...rest) {
        console.log(chalk`{blue [Application: ${this.id}]} - ${colorLogLevel(level)} -`, ...rest);
    }

    includedFileScope(file: string) {
        if (!file) return "sandbox";

        if (file.includes(TYPEDAEMON_PATH)) {
            return "host";
        }

        // Relative import or Full-Application node_modules dependency
        if (file.includes("/applications/")) {
            return "sandbox";
        }

        // Lite-Application node_modules dependency
        if (file.includes(this.hypervisor.operations_directory)) {
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

        this.cleanupTasks.mark(() => {
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
        // TODO: It would be nice to figure out some static analysis or something to be able to just export the required packages from the module
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
            packageJson = this.generateOpPackageJson({ dependencies });
            await fs.promises.writeFile(packageFilePath, JSON.stringify(packageJson));
        }
        if (Object.keys(packageJson?.dependencies || {}).length > 0) {
            this.logMessage("info", `Installing packages`);
            await this.installDependencies();
        }
        // if (shouldManagePackage) {
        //     this.logMessage("debug", `Removing generated package.json`);
        //     await fs.promises.unlink(packageFilePath);
        // }

        this.transitionState("compiling");

        const module = await this.compileModule();
        const mainExport = module[this.options.export || 'default'];
        const metadata: ApplicationMetadata = (typeof mainExport == 'object' && mainExport) || mainExport.metadata || module.metadata || { applicationClass: mainExport, ...module, ...mainExport };

        this.transitionState("starting")

        const AppClass = metadata.applicationClass;
        this._instance = new AppClass(this);

        // Self-watch for config changes
        if (this.options.watch?.config) {
            const disposer = this.hypervisor.watchConfigEntry<AppConfiguration>(`apps.${this.id}`, async (ncfg, ocfg) => {
                if (this.state != 'started') return;

                if (!deepEqual(immutableConfigBits(ocfg), immutableConfigBits(ncfg))) {
                    this.logMessage("debug", `Configuration changed significantly, restarting`);
                    this.namespace.reinitializeInstance(this);
                    return
                }

                this.logMessage("debug", `Configuration updated, processing changes`);

                try {
                    this.options.config = ncfg;
                    await this.invoke(() => this.instance.configuration_updated(ncfg, ocfg));
                } catch (ex) {
                    if (ex instanceof RequireRestart) {
                        this.logMessage("debug", `Determined that changes require an app restart, restarting`);
                        this.namespace.reinitializeInstance(this);
                    } else {
                        this.logMessage("error", `Error occurred while updating configuration:`, ex);
                        throw ex;
                    }
                }
            });
            this.cleanupTasks.mark(disposer);
        }

        // TODO Load and await required plugins (determine by whether the app `require("ha")`?)
        //    Or are plugins just assumed to be loaded?

        await this.invoke(() => this.instance.initialize?.());
        await this.resumableStore.resume([], {
            app: this._instance,
        })

        this.transitionState('started');
    }

    async _shutdown() {
        this.transitionState('stopping')

        if (this.instance) {
            await this.invoke(() => this.instance.shutdown?.());
        }

        this.cleanupTasks.cleanup();

        const resumables = await this.resumableStore.suspendAndStore();
        // TODO Write to file

        if (this._vm) this._vm.removeAllListeners();

        this.transitionState('stopped')
    }

    private async installDependencies() {
        const subprocess = execa('yarn', ['install'], {
            cwd: this.operating_directory,
        })
        subprocess.stdout.on('data', (data) => {
            this.logMessage("debug", `yarn - ${data.toString().trim()}`)
        });
        // subprocess.stderr.on('data', (data) => {
        //     this.logMessage("error", `yarn - ${data.toString().trim()}`)
        // });
        const { stdout, stderr, exitCode, failed } = await subprocess;
        if (failed || exitCode > 0) {
            throw new Error(`Failed to install dependencies with yarn`);
        }
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
            this._isThickApp = fs.existsSync(path.join(path.dirname(this.entrypoint), 'package.json'));
        }
        return this._isThickApp;
    }

    get operating_directory() {
        const wd = this.hypervisor.working_directory;

        if (this.options.operating_directory) {
            return path.resolve(path.dirname(wd), this.options.operating_directory);
        }

        if (this.isThickApp) {
            return path.dirname(this.entrypoint);
        }

        return path.resolve(this.hypervisor.operations_directory, "app_environments", this.id);
    }

    private async compileModule() {
        const vm = await this.vm();
        return vm.runFile(this.entrypoint);
    }

    private _vm: NodeVM;
    private async vm() {
        if (this._vm) return this._vm;
        const vm = await createApplicationVM(this);
        return this._vm = vm;
    }
}

function immutableConfigBits(cfg: AppConfiguration): Partial<AppConfiguration> {
    const immutable = { ...cfg };
    delete immutable.config;
    delete immutable.logs;
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
