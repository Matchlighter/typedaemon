
import * as fs from "fs"
import * as fse from "fs-extra"
import * as path from "path";
import { CommandModule } from "yargs";

import { saveAppRegistry, saveGeneratedTsconfig } from "../common/generate_tsconfig";
import { SimpleStore, TD_DEVELOPER_MODE, TD_MODULES_PATH, TD_VERSION, TD_VERSION_PRECISE, __package_dir } from "../common/util";
import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { InstallOpts, installDependencies } from "../hypervisor/packages";

import { dev_types as RUNTIME_DEPENDENCIES } from "../runtime/runtime";

const INSTALL_MODE: 'download' | 'copy' | 'link' = 'copy';

// Packages to keep but skip following their dependencies (to avoid e.g. babel)
const KEEP_WITHOUT_DEPS = ['typedaemon'];
const INCLUDE_DEPS = false;

async function buildPackageList(nmPath: string) {
    const keptPackages = new Set<string>();
    for (const pkg of KEEP_WITHOUT_DEPS) {
        keptPackages.add(pkg);
    }

    async function keepPackage(pkgName: string) {
        if (keptPackages.has(pkgName)) return;

        keptPackages.add(pkgName);

        if (INCLUDE_DEPS) {
            const pkgpath = path.join(nmPath, pkgName);
            const pkgjson = path.join(pkgpath, "package.json");
            if (await fse.pathExists(pkgjson)) {
                const pkgdata = JSON.parse(await fs.promises.readFile(pkgjson, "utf8"));
                const deps = { ...pkgdata.dependencies }; //, ...pkgdata.peerDependencies, ...pkgdata.optionalDependencies };
                for (const dep of Object.keys(deps || {})) {
                    await keepPackage(dep);
                }
            }
        }
    }

    for (const pkg of RUNTIME_DEPENDENCIES) {
        await keepPackage(pkg);
    }

    return keptPackages;
}

async function listPackages(nmPath: string) {
    const dircontents = await fse.readdir(nmPath);
    const packages = new Set<string>();
    for (const item of dircontents) {
        if (item.startsWith('.')) continue;
        const itempath = path.join(nmPath, item);
        if ((await fse.stat(itempath)).isDirectory()) {
            if (item.startsWith('@')) {
                const subcontents = await fse.readdir(itempath);
                for (const subitem of subcontents) {
                    if (subitem.startsWith('.')) continue;
                    const subitempath = path.join(itempath, subitem);
                    if ((await fse.stat(subitempath)).isDirectory()) {
                        packages.add(`${item}/${subitem}`);
                    }
                }
            } else {
                packages.add(item);
            }
        }
    }
    return packages;
}

async function copyPackageTypeDefs(srcpkg: string, destpkg: string) {
    await fse.mkdirp(destpkg);

    await fse.copy(srcpkg, destpkg, {
        filter: (src, dest) => {
            if (src.endsWith('.d.ts') || src.endsWith('package.json')) {
                return true;
            }
            if (fs.statSync(src).isDirectory()) {
                return true;
            }
            return false;
        }
    });
}

async function copyTypeDefs(src: string, dest: string) {
    const keptPackages = await buildPackageList(src);
    const packages = await listPackages(src);
    for (const pkg of packages) {
        if (!keptPackages.has(pkg)) continue;

        const srcpkg = path.join(src, pkg);
        const destpkg = path.join(dest, pkg);

        console.log(` - Copying type definitions for ${pkg}`);
        await copyPackageTypeDefs(srcpkg, destpkg);
    }
}

export async function syncDevEnv(wdir: string | UtilityHypervisor) {
    let hv: UtilityHypervisor;
    if (typeof wdir == "string") {
        hv = new UtilityHypervisor({
            working_directory: wdir,
        });
        await hv.start();
    } else {
        hv = wdir;
    }

    console.log("Generating tsconfig.json")
    await saveGeneratedTsconfig(hv);
    await saveAppRegistry(hv);

    console.log("Installing Type Definitions")
    const nmpath = path.join(hv.operations_directory, 'node_modules');
    if (INSTALL_MODE == 'download') {
        // Link TD Directly if it's not installed as a module
        const deps = TD_DEVELOPER_MODE ? path.resolve(__package_dir, "package.json") : {
            "typedaemon": TD_VERSION,
        };
        const depOpts: InstallOpts = {
            dir: hv.operations_directory,
            lockfile: false,
        }
        await installDependencies(depOpts, deps);
    } else if (INSTALL_MODE == 'copy') {
        if (await fse.exists(nmpath)) {
            await fse.rm(nmpath, { recursive: true });
        }
        await fse.mkdirp(nmpath);

        if (TD_DEVELOPER_MODE) {
            if (nmpath.startsWith(__package_dir)) {
                await copyTypeDefs(path.join(__package_dir, 'node_modules'), nmpath);
            } else {
                const tdnmpath = path.join(nmpath, 'typedaemon/node_modules');
                await copyTypeDefs(tdnmpath, nmpath);

                // TD Itself
                await copyPackageTypeDefs(__package_dir, path.join(nmpath, 'typedaemon'));
            }
        } else {
            await copyTypeDefs(TD_MODULES_PATH, nmpath);
        }
    } else if (INSTALL_MODE == 'link') {
        if (await fse.exists(nmpath)) {
            await fse.rm(nmpath, { recursive: true });
        }
        await fse.link(path.join(__package_dir, 'node_modules'), nmpath)
    }

    if (typeof wdir == "string") {
        await hv.shutdown();
    }
}

export default {
    command: "dev_env",
    describe: "Setup/Sync the Development Environment",
    builder: y => y.strict(false).options({
        'fast': { boolean: true, default: false, desc: "Only sync if the TypeDaemon version mismatches" },
    }),
    handler: async (argv) => {
        // This loads Babel, which has a custom resolver. We need to execute from where TD is installed, but against the TD config
        if (process.env['TYPEDAEMON_MODULE']) {
            process.chdir(path.join(process.env['TYPEDAEMON_MODULE'], '../..'));
        }

        const hv = new UtilityHypervisor({
            working_directory: argv.config as string,
        });

        const meta = new SimpleStore<any>(path.join(hv.operations_directory, "dev_env.json"));
        await meta.load();

        if (argv.fast) {
            if (meta.data.devenv_version == TD_VERSION_PRECISE) {
                console.log("Already up to date");
                return;
            }
        }

        await hv.start();
        await syncDevEnv(hv);
        await hv.shutdown();

        meta.data.devenv_version = TD_VERSION_PRECISE;
        await meta.save();
    },
} as CommandModule
