import { CommandModule } from "yargs";

import { Hypervisor } from "../hypervisor/hypervisor";
import { redirectConsole } from "../hypervisor/logging";

export default {
    command: "run",
    describe: "Start the Hypervisor",
    builder: y => y.strict(false).options({
        'watch': { boolean: true, default: true, desc: "Watch for file changes and act accordingly" },
    }),
    handler: async (argv) => {
        redirectConsole();

        const hv = new Hypervisor({
            working_directory: argv.config as any,
            no_watching: !argv.watch,
        })

        await hv.start()
    },
} as CommandModule
