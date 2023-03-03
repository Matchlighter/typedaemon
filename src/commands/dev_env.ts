
import path = require("path");
import { CommandModule } from "yargs";

import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { installDependencies } from "../hypervisor/packages";
import { __package_dir } from "../common/util";
import { saveGeneratedTsconfig } from "../common/generate_tsconfig";

export async function syncDevEnv(wdir: string) {
    const hv = new UtilityHypervisor({
        working_directory: wdir,
    })

    await hv.start()
    console.log("Generating tsconfig.json")
    await saveGeneratedTsconfig(hv);
    console.log("Installing Type Definitions")
    await installDependencies((msg) => console.log('  ' + msg), hv.operations_directory, path.resolve(__package_dir, "package.json"))
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
