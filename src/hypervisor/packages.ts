import fs = require("fs");
import execa = require("execa");
import path = require("path");

export async function installDependencies(logger: (...args: any[]) => void, dir: string, dependencies?) {
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

    const subprocess = execa('yarn', ['install'], {
        cwd: dir,
    })
    subprocess.stdout.on('data', (data) => {
        console.log('  ' + data.toString().trim())
        // logger("debug", `yarn - ${data.toString().trim()}`)
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
