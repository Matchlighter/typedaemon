import fs = require("fs");
import execa = require("execa");
import path = require("path");
import { TD_MODULES_PATH } from "../common/util";
import { LogLevel, logMessage } from "./logging";

export interface InstallOpts {
    dir: string;
    lockfile?: boolean;
    devPackages?: boolean;
}

export async function installDependencies({ dir, ...opts }: InstallOpts, dependencies?) {
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
            env: {
                NODE_ENV: "development",
            }
        }),
        {
            ignored_patterns: [
                "No license field",
            ]
        }
    )

    logMessage("info", "Patching packages")

    await handle_subproc(
        execa(path.join(TD_MODULES_PATH, '.bin', `patch-package`), [], {
            cwd: dir,
        }),
        {
            ignored_patterns: [
                "No license field",
                "No patch files found",
            ]
        }
    )

    if (dependencies) {
        await fs.promises.unlink(pkgjsonFile);
    }
}

async function handle_subproc(proc: execa.ExecaChildProcess, { ignored_patterns }: { ignored_patterns?: (string | RegExp)[] } = { ignored_patterns: [] }) {
    const printer_factory = (level: LogLevel) => (data) => {
        const lines = (data.toString() as string).trim().split("\n");
        lineloop: for (let l of lines) {
            for (let p of ignored_patterns) {
                if (l.match(p)) continue lineloop;
            }
            logMessage(level, l);
        }
    }
    proc.stdout.on('data', printer_factory("debug"));
    proc.stderr.on('data', printer_factory("warn"));
    const { stdout, stderr, exitCode, failed } = await proc;
    if (failed || exitCode > 0) {
        throw new Error(`Failed to install dependencies with yarn`);
    }
}
