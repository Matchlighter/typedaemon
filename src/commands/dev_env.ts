
import fs = require("fs")
import fse = require("fs-extra")
import path = require("path");
import { CommandModule } from "yargs";

import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { InstallOpts, installDependencies } from "../hypervisor/packages";
import { TD_DEVELOPER_MODE, TD_MODULES_PATH, TD_VERSION, __package_dir } from "../common/util";
import { saveGeneratedTsconfig } from "../common/generate_tsconfig";

const INSTALL_MODE: 'download' | 'copy' | 'link' = 'copy';

export async function syncDevEnv(wdir: string) {
    const hv = new UtilityHypervisor({
        working_directory: wdir,
    })

    await hv.start()
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
            logger: (msg) => console.log('  ' + msg),
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

    await hv.shutdown();
}

export default {
    command: "dev_env",
    describe: "Setup/Sync the Development Environment",
    builder: y => y.strict(false).options({

    }),
    handler: async (argv) => {
        await syncDevEnv(argv.config as string);
    },
} as CommandModule
