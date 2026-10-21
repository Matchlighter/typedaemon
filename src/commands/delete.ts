import chalk from "chalk";
import prompts from "prompts";
import { CommandModule } from "yargs";

import { controlRequest } from "../common/control_socket";

interface DestroyableApp {
    id: string;
    operating_directory: string;
}

/** List what will be removed, confirm, and have the Hypervisor destroy each app */
export async function destroyApplications(working_directory: string, ids: string[] | undefined, { yes }: { yes?: boolean }) {
    const apps = await controlRequest<DestroyableApp[]>(working_directory, "apps.destroyable", { ids });

    if (apps.length == 0) {
        console.log(chalk`{green Nothing to clean}`);
        return;
    }

    console.log(chalk`{cyan The following apps will have their entities, persistence, and logs removed:}`);
    for (let app of apps) {
        console.log(chalk` - {bold ${app.id}} ({cyan ${app.operating_directory}})`);
    }

    if (!yes) {
        const answ = await prompts({
            name: 'confirm',
            type: 'confirm',
            message: `Continue?`,
        })
        if (!answ.confirm) return;
    }

    for (let app of apps) {
        console.log(chalk`{cyan Destroying} {bold ${app.id}}`);
        await controlRequest(working_directory, "apps.destroy", { id: app.id });
    }

    console.log(chalk`{green Done}`);
}

export default {
    command: "delete <app>",
    describe: "Remove all resources (entities, persistence) of an app that is no longer configured",
    builder: y => y.options({
        yes: { alias: 'y', boolean: true, desc: "Do not ask for confirmation" },
    }),
    handler: async (argv) => {
        await destroyApplications(argv.config as string, [argv.app as string], { yes: argv.yes as boolean });
    },
} as CommandModule
