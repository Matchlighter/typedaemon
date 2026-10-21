import { once } from "events";
import { CommandModule } from "yargs";

import { controlStream } from "../common/control_socket";

export default {
    command: "repl",
    describe: "Open a REPL in the running Hypervisor",
    handler: async (argv) => {
        const terminal = !!process.stdin.isTTY;
        const socket = await controlStream(argv.config as string, "repl", {
            terminal,
            columns: process.stdout.columns,
        });

        // The remote REPL handles line editing, completion and Ctrl+C/Ctrl+D
        if (terminal) process.stdin.setRawMode(true);
        process.stdin.pipe(socket);
        socket.pipe(process.stdout);

        await once(socket, "close");

        process.stdin.unpipe(socket);
        if (terminal) process.stdin.setRawMode(false);
        process.stdin.pause();
    },
} as CommandModule
