import fs = require("fs");
import execa = require("execa");
import path = require("path");
import { __package_dir } from "../common/util";

export interface InstallOpts {
    dir: string;
    lockfile?: boolean;
    devPackages?: boolean;
    logger: (...args: any[]) => void;
}

export async function installDependencies({ dir, logger, ...opts }: InstallOpts, dependencies?) {
    const flags: string[] = ["--non-interactive"];

    if (opts.lockfile === false) {
        flags.push("--no-lockfile");
    }

    if (!opts.devPackages) {
        flags.push("--production");
    }

    const pkgjsonFile = path.join(dir, "package.json");
    if (dependencies) {
        if (typeof dependencies == "string") {
            await fs.promises.copyFile(dependencies, pkgjsonFile);
        } else {
            const tempPackageJson = {
                "name": "TDSYSTEM",
                "version": "0.0.1",
                "license": "UNLICENSED",
                "typedaemon_managed": true,
                "dependencies": dependencies,
            }
            await fs.promises.writeFile(pkgjsonFile, JSON.stringify(tempPackageJson));
        }
    }

    await handle_subproc(
        execa('yarn', ['install', ...flags], {
            cwd: dir,
        }),
        logger,
    )

    // logger("Patching Packages")

    // await handle_subproc(
    //     execa('patch-package', ['--patch-dir', path.join(__package_dir, 'patches')], {
    //         cwd: dir,
    //     }),
    //     logger,
    // )

    if (dependencies) {
        await fs.promises.unlink(pkgjsonFile);
    }
}

async function handle_subproc(proc: execa.ExecaChildProcess, logger: InstallOpts['logger']) {
    proc.stdout.on('data', (data) => {
        logger(data.toString().trim())
    });
    proc.stderr.on('data', (data) => {
        logger(data.toString().trim())
    });
    // subprocess.stderr.on('data', (data) => {
    //     host.logMessage("error", `yarn - ${data.toString().trim()}`)
    // });
    const { stdout, stderr, exitCode, failed } = await proc;
    if (failed || exitCode > 0) {
        throw new Error(`Failed to install dependencies with yarn`);
    }
}
