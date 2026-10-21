import execa from "execa";
import { CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";

export class CliError extends Error {

}

/**
 * Create a command that forwards all of its arguments, verbatim, to an executable.
 * The executable is run in the current directory, which the `td` wrapper maps into the container.
 */
export function passthroughCommand(command: string, executable: string, describe: string): CommandModule {
    return {
        command: `${command} [args..]`,
        describe,
        // Leave flags (including --help) for the executable
        builder: y => y.strict(false).help(false).version(false),
        handler: async () => {
            // yargs parses and mangles flags, so take the raw arguments that follow the command
            const raw_args = hideBin(process.argv);
            const args = raw_args.slice(raw_args.indexOf(command) + 1);

            try {
                await execa(executable, args, { stdio: "inherit" });
            } catch (ex) {
                // Failed to spawn at all
                if (ex.exitCode == null) throw new CliError(ex.shortMessage);
                process.exitCode = ex.exitCode;
            }
        },
    }
}
