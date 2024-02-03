
import fs = require("fs")
import fse = require("fs-extra")
import path = require("path");
import { CommandModule } from "yargs";

import { saveGeneratedTsconfig } from "../common/generate_tsconfig";
import { SimpleStore, TD_DEVELOPER_MODE, TD_MODULES_PATH, TD_VERSION, TD_VERSION_PRECISE, __package_dir } from "../common/util";
import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { InstallOpts, installDependencies } from "../hypervisor/packages";

const INSTALL_MODE: 'download' | 'copy' | 'link' = 'copy';

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
                await fse.copy(path.join(__package_dir, 'node_modules'), nmpath);
            } else {
                await fse.copy(__package_dir, path.join(nmpath, 'typedaemon'));

                const tdnmpath = path.join(nmpath, 'typedaemon/node_modules');
                for (let fd of await fse.readdir(tdnmpath)) {
                    await fse.move(path.join(tdnmpath, fd), path.join(nmpath, fd));
                }
            }
        } else {
            await fse.copy(TD_MODULES_PATH, nmpath);
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
