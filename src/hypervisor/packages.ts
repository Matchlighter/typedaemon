import fs = require("fs");
import execa = require("execa");
import path = require("path");

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

    const subprocess = execa('yarn', ['install', ...flags], {
        cwd: dir,
    })
    subprocess.stdout.on('data', (data) => {
        logger(data.toString().trim())
    });
    // subprocess.stderr.on('data', (data) => {
    //     host.logMessage("error", `yarn - ${data.toString().trim()}`)
    // });
    const { stdout, stderr, exitCode, failed } = await subprocess;
    if (failed || exitCode > 0) {
        throw new Error(`Failed to install dependencies with yarn`);
    }
    if (dependencies) {
        await fs.promises.unlink(pkgjsonFile);
    }
}
