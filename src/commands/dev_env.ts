
import path = require("path");
import { CommandModule } from "yargs";

import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { InstallOpts, installDependencies } from "../hypervisor/packages";
import { TD_DEVELOPER_MODE, TD_VERSION, __package_dir } from "../common/util";
import { saveGeneratedTsconfig } from "../common/generate_tsconfig";

export async function syncDevEnv(wdir: string) {
    const hv = new UtilityHypervisor({
        working_directory: wdir,
    })

    await hv.start()
    console.log("Generating tsconfig.json")
    await saveGeneratedTsconfig(hv);

    console.log("Installing Type Definitions")
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
