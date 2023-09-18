import fs = require("fs")
import path = require("path");
import execa = require("execa");
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

        if (hv.currentConfig.daemon.ssh_tunnel) {
            await execa("s6-svc", ["-u", "sshd"]);
            await execa("s6-svc", ["-u", "sshd_socket"]);

            await fs.promises.writeFile(path.join(hv.operations_directory, "connection_params"), [
                "TD_CONNECTION_MODE=SSH",
            ].join("\n"))
        }
    },
} as CommandModule
