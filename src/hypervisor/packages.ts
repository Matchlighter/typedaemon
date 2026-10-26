import * as fs from "fs";
import execa from "execa";
import * as path from "path";
import { TD_MODULES_PATH } from "../common/util";
import { LogLevel, logMessage } from "./logging";

export const YARN_BIN = "yarn";
export const PATCH_PACKAGE_BIN = path.join(TD_MODULES_PATH, ".bin", "patch-package");

const MANAGED_FLAG = "typedaemon_managed";
const CONFIG_PKG_NAME = "TDCONFIG";
/** Copy of the managed package.json, written only after a successful install */
const CONFIG_INSTALLED_MARKER = ".typedaemon_installed.json";

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
                [MANAGED_FLAG]: true,
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
    const pkgjsonFile = path.join(dir, "package.json");
    const markerFile = path.join(dir, CONFIG_INSTALLED_MARKER);
    const nodeModulesDir = path.join(dir, "node_modules");
    const hasDependencies = dependencies && Object.keys(dependencies).length > 0;

    if (fs.existsSync(pkgjsonFile)) {
        let existing: any;
        try {
            existing = JSON.parse(await fs.promises.readFile(pkgjsonFile, "utf8"));
        } catch (ex) {
            if (hasDependencies) logMessage("warn", `Could not parse config root package.json; configured \`dependencies\` will not be installed.`, ex);
            return;
        }
        if (!existing?.[MANAGED_FLAG]) {
            if (hasDependencies) logMessage("warn", `Config root has a non-managed package.json; configured \`dependencies\` will not be installed. Add them to that package.json instead.`);
            return;
        }
    }

    if (!hasDependencies) {
        // Clear state left by previously-configured packages (only reached if any package.json is ours)
        if (!fs.existsSync(pkgjsonFile)) return;
        logMessage("info", "Removing pre-installed packages");
        await fs.promises.rm(nodeModulesDir, { recursive: true, force: true });
        await fs.promises.rm(markerFile, { force: true });
        await fs.promises.rm(pkgjsonFile, { force: true });
        return;
    }

    const serialized = JSON.stringify({
        "name": CONFIG_PKG_NAME,
        "version": "0.0.1",
        "license": "UNLICENSED",
        "private": true,
        [MANAGED_FLAG]: true,
        "dependencies": dependencies,
    }, null, 2);

    const installed = fs.existsSync(markerFile) ? await fs.promises.readFile(markerFile, "utf8") : null;
    if (installed == serialized && fs.existsSync(nodeModulesDir)) {
        logMessage("debug", "Pre-installed packages are up to date");
        return;
    }

    logMessage("info", "Installing pre-installed packages");
    await fs.promises.rm(markerFile, { force: true });
    await fs.promises.writeFile(pkgjsonFile, serialized);
    await installDependencies({ dir });
    await fs.promises.writeFile(markerFile, serialized);
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
