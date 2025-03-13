import { CommandModule } from "yargs";
import fs = require('fs-extra');
import { promises as fsp } from 'fs'
import path = require("path");
import ejs = require("ejs");
import prompts = require("prompts");
import chalk = require("chalk");

import { CliError } from "../cli";
import { __package_dir, walk } from "../common/util";
import { syncDevEnv } from "./dev_env";

export default {
    command: "init [name]",
    builder: y => y.options({
        force: { alias: 'f', boolean: true, },
        automated: { boolean: true, },
    }),
    handler: async (argv) => {
        const name = argv.name as string;
        const targDir = path.resolve(process.cwd(), name);

        if (argv.automated) {
            if (!argv.force && await fs.pathExists(path.join(targDir, "typedaemon_config.ts"))) {
                console.log("TypeDaemon already initialized")
                return;
            }
        } else if (!argv.force) {
            if (await fs.pathExists(targDir)) {
                const dir = await fsp.readdir(targDir);
                if (dir.length > 0) {
                    throw new CliError("Directory not empty")
                }
            }
        }

        console.log(chalk`{cyan Initializing TypeDaemon project in} {cyan.bold ${targDir}}`);

        await fs.mkdirp(targDir);

        // const pjson = require(path.join(__package_dir, './package.json'));
        const ejsContext = {
            // project_name: name || 'crucible-project',
            // crucible_version_req: `^${pjson.version}`
        }

        console.log(chalk`{cyan Copying templates}`);

        const exampleDir = path.join(__package_dir, 'skel');
        for await (let file of walk(exampleDir)) {
            const relp = path.relative(exampleDir, file);
            let targp = path.join(targDir, relp);

            let rendered;
            if (path.extname(relp) == '.ejs') {
                targp = targp.replace(/\.ejs$/, '');
                rendered = await ejs.renderFile(file, ejsContext, {});
            } else {
                rendered = await fsp.readFile(file, 'utf-8');
            }

            if (await fs.pathExists(targp) && (await fsp.readFile(targp, 'utf-8') != rendered)) {
                if (argv.automated) continue;

                const answ = await prompts({
                    name: 'overwrite',
                    type: 'confirm',
                    message: chalk`File {cyan ${targp}} exists. Overwrite?`,
                })
                if (!answ.overwrite) continue;
            }

            await fs.mkdirp(path.dirname(targp));

            await fsp.writeFile(targp, rendered, 'utf-8');

            console.log(chalk` - {green Created} {cyan ${targp}}`);
        }

        if (!argv.automated) {
            console.log(chalk`{cyan Syncing Dev Env}`)
            await syncDevEnv(targDir);
        }

        console.log(chalk`{green TypeDaemon project initialized}`)
    }
} as CommandModule
