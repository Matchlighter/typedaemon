#!/usr/bin/env node
import yargs = require('yargs/yargs');
import { hideBin } from 'yargs/helpers'

import path = require('path');
import chalk = require('chalk');

export class CliError extends Error {

}

const cli = yargs(hideBin(process.argv));
cli.parserConfiguration({
    // "unknown-options-as-args": true,
})

cli.option('config', {
    alias: 'c',
    describe: "Specify the TypeDaemon working directory",
    string: true,
    default: () => process.cwd(),
    coerce: (v: string) => {
        // TODO Traverse and locate?
        if (v.indexOf("/") !== 0) {
            // If this isn't an absolute path, make it relative to the working directory.
            v = path.join(process.cwd(), v);
        }
        return v;
    }
})

cli.middleware((argv) => {
    process.env.NODE_ENV ||= 'production'

    // if (isDevExec) {
    //     override_require((req, parent) => req.startsWith('ansible') || req.startsWith('crucible'), (req, parent) => {
    //         req = req.replace('crucible/dist', 'crucible');
    //         return req.replace(/^(ansible-)crucible?/, path.join(__dirname, '../'))
    //     });
    // }
})

cli.commandDir('commands', {
    visit(commandModule) {
        return commandModule.default;
    },
    exclude: /\.d\.ts$/,
    extensions: ['ts', 'js'],
})

cli.showHelpOnFail(true)

cli.fail((msg, err, yargs) => {
    if (err instanceof CliError) {
        if (err.message) console.error(chalk`{red ${err.message}}`);
    } else if (msg) {
        yargs.showHelp()
        console.error(chalk`{red ${msg}}`);
    } else {
        console.log(msg, err)
    }
    process.exit(1)
})

cli.demandCommand();
cli.strict();
cli.help();
cli.wrap(72);

(async () => {
    try {
        await cli.parseAsync();
    } finally {
    }
})();
