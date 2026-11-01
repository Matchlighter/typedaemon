
import * as fs from "fs"
import * as fse from "fs-extra"
import * as path from "path";
import { CommandModule } from "yargs";

import { saveAppRegistry, saveGeneratedTsconfig } from "../common/generate_tsconfig";
import { SimpleStore, TD_DEVELOPER_MODE, TD_MODULES_PATH, TD_VERSION, TD_VERSION_PRECISE, __package_dir } from "../common/util";
import { UtilityHypervisor } from "../hypervisor/hypervisor";
import { InstallOpts, installDependencies } from "../hypervisor/packages";

import { dev_types as RUNTIME_DEPENDENCIES } from "../runtime/runtime";

const INSTALL_MODE: 'download' | 'copy' | 'link' = 'copy';

// Packages whose type definitions are exposed to user code (deps are intentionally not followed, to avoid e.g. babel)
const TYPE_PACKAGES = [...RUNTIME_DEPENDENCIES, 'typedaemon'];

// Records what was copied (pkg -> version) so syncs only touch packages that changed
const TYPES_MANIFEST = '.td-types.json';

/** Copy only `.d.ts` and `package.json` files, skipping nested node_modules. Async to keep the event loop free. */
async function copyPackageTypeDefs(srcpkg: string, destpkg: string) {
    for (const entry of await fs.promises.readdir(srcpkg, { withFileTypes: true })) {
        const src = path.join(srcpkg, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') await copyPackageTypeDefs(src, path.join(destpkg, entry.name));
        } else if (entry.name.endsWith('.d.ts') || entry.name === 'package.json') {
            await fse.mkdirp(destpkg);
            await fs.promises.copyFile(src, path.join(destpkg, entry.name));
        }
    }
}

async function readPackageVersion(dir: string): Promise<string | undefined> {
    try {
        return JSON.parse(await fs.promises.readFile(path.join(dir, "package.json"), "utf8")).version;
    } catch {
        return undefined;
    }
}

/** Map of package name -> {source dir, version} that should be present in the dev env */
async function resolveTypeSources(nmpath: string) {
    const srcRoot = TD_DEVELOPER_MODE ? path.join(__package_dir, 'node_modules') : TD_MODULES_PATH;
    const sources = new Map<string, { dir: string, version: string }>();
    for (const pkg of TYPE_PACKAGES) {
        let dir = path.join(srcRoot, pkg);
        let version: string | undefined;
        if (pkg === 'typedaemon' && TD_DEVELOPER_MODE) {
            // TD isn't installed as a module in dev mode; use the checkout (unless the env already lives inside it)
            if (nmpath.startsWith(__package_dir)) continue;
            dir = __package_dir;
            version = TD_VERSION_PRECISE;
        } else {
            version = await readPackageVersion(dir);
        }
        if (version) sources.set(pkg, { dir, version });
    }
    return sources;
}

async function syncTypeDefs(nmpath: string) {
    const manifestPath = path.join(nmpath, TYPES_MANIFEST);
    let manifest: Record<string, string> = {};
    try {
        manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch {
        // No/invalid manifest: contents are unknown (e.g. legacy full copy), so start clean
        await fse.rm(nmpath, { recursive: true, force: true });
    }
    await fse.mkdirp(nmpath);

    const sources = await resolveTypeSources(nmpath);

    for (const pkg of Object.keys(manifest)) {
        if (!sources.has(pkg)) {
            await fse.rm(path.join(nmpath, pkg), { recursive: true, force: true });
            delete manifest[pkg];
        }
    }

    for (const [pkg, { dir, version }] of sources) {
        const dest = path.join(nmpath, pkg);
        if (manifest[pkg] === version && await fse.pathExists(dest)) continue;

        console.log(` - Copying type definitions for ${pkg}`);
        await fse.rm(dest, { recursive: true, force: true });
        await copyPackageTypeDefs(dir, dest);
        manifest[pkg] = version;
    }

    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export async function syncDevEnv(wdir: string | UtilityHypervisor) {
    let hv: UtilityHypervisor;
    if (typeof wdir == "string") {
        hv = new UtilityHypervisor({
            working_directory: wdir,
        });
        await hv.start();
    } else {
        hv = wdir;
    }

    console.log("Generating tsconfig.json")
    await saveGeneratedTsconfig(hv);
    await saveAppRegistry(hv);

    console.log("Installing Type Definitions")
    const nmpath = path.join(hv.operations_directory, 'node_modules');
    if (INSTALL_MODE == 'download') {
        // Link TD Directly if it's not installed as a module
        const deps = TD_DEVELOPER_MODE ? path.resolve(__package_dir, "package.json") : {
            "typedaemon": TD_VERSION,
        };
        const depOpts: InstallOpts = {
            dir: hv.operations_directory,
            lockfile: false,
        }
        await installDependencies(depOpts, deps);
    } else if (INSTALL_MODE == 'copy') {
        await syncTypeDefs(nmpath);
    } else if (INSTALL_MODE == 'link') {
        if (await fse.exists(nmpath)) {
            await fse.rm(nmpath, { recursive: true });
        }
        await fse.link(path.join(__package_dir, 'node_modules'), nmpath)
    }

    if (typeof wdir == "string") {
        await hv.shutdown();
    }
}

export default {
    command: "dev_env",
    describe: "Setup/Sync the Development Environment",
    builder: y => y.strict(false).options({
        'fast': { boolean: true, default: false, desc: "Only sync if the TypeDaemon version mismatches" },
    }),
    handler: async (argv) => {
        // This loads Babel, which has a custom resolver. We need to execute from where TD is installed, but against the TD config
        if (process.env['TYPEDAEMON_MODULE']) {
            process.chdir(path.join(process.env['TYPEDAEMON_MODULE'], '../..'));
        }

        const hv = new UtilityHypervisor({
            working_directory: argv.config as string,
        });

        const meta = new SimpleStore<any>(path.join(hv.operations_directory, "dev_env.json"));
        await meta.load();

        if (argv.fast) {
            if (meta.data.devenv_version == TD_VERSION_PRECISE) {
                console.log("Already up to date");
                return;
            }
        }

        await hv.start();
        await syncDevEnv(hv);
        await hv.shutdown();

        meta.data.devenv_version = TD_VERSION_PRECISE;
        await meta.save();
    },
} as CommandModule
