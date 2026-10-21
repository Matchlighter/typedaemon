import { CommandModule } from "yargs";

import { destroyApplications } from "./delete";

export default {
    command: "clean",
    describe: "Remove resources of all apps that are no longer configured",
    builder: y => y.options({
        yes: { alias: 'y', boolean: true, desc: "Do not ask for confirmation" },
    }),
    handler: async (argv) => {
        await destroyApplications(argv.config as string, undefined, { yes: argv.yes as boolean });
    },
} as CommandModule
