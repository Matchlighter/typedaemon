import * as fs from "fs";
import execa from "execa";
import * as path from "path";
import { TD_MODULES_PATH } from "../common/util";
import { LogLevel, logMessage } from "./logging";

export const YARN_BIN = "yarn";
export const PATCH_PACKAGE_BIN = path.join(TD_MODULES_PATH, ".bin", "patch-package");

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
        execa(YARN_BIN, ['install', ...flags], {
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
        execa(PATCH_PACKAGE_BIN, [], {
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

/**
 * Install the globally-configured `dependencies` into `<dir>/node_modules` (the config root) so apps can load them (in their VMs).
 * Manages `<dir>/package.json`; skips if satisfied or if the user manages that file themselves.
 */
export async function installConfigDependencies(dir: string, dependencies: Record<string, string> | undefined) {
    if (!dependencies || Object.keys(dependencies).length == 0) return;

    const pkgjsonFile = path.join(dir, "package.json");
    const packageJson = {
        "name": "TDCONFIG",
        "version": "0.0.1",
        "license": "UNLICENSED",
        "private": true,
        "typedaemon_managed": true,
        "dependencies": dependencies,
    }
    const serialized = JSON.stringify(packageJson, null, 2);

    if (fs.existsSync(pkgjsonFile)) {
        const existingRaw = await fs.promises.readFile(pkgjsonFile, "utf8");
        let existing: any = {};
        try { existing = JSON.parse(existingRaw) } catch { }
        if (!existing['typedaemon_managed']) {
            logMessage("warn", `Config root has a non-managed package.json; configured \`dependencies\` will not be installed. Add them to that package.json instead.`);
            return;
        }
        if (existingRaw == serialized && fs.existsSync(path.join(dir, "node_modules"))) {
            logMessage("debug", "Pre-installed packages are up to date");
            return;
        }
    }

    logMessage("info", "Installing pre-installed packages");
    await fs.promises.writeFile(pkgjsonFile, serialized);
    await installDependencies({ dir });
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
