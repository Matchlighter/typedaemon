import * as path from "path";

/** Where apps' default operating directories live. The one place that knows the on-disk layout. */
export const environmentsDirectory = (operationsDirectory: string) => path.resolve(operationsDirectory, "app_environments");

/**
 * The default operating directory of app `id`. Ids may come from the outside (CLI, dashboard) and end up in a recursive delete,
 * so anything that is not one plain directory name below `app_environments` is rejected.
 */
export function appDirectory(operationsDirectory: string, id: string) {
    if (!id || id === "." || id === ".." || /[\\/]/.test(id) || id !== path.basename(id)) throw new Error(`Invalid app id: ${JSON.stringify(id)}`);
    return path.join(environmentsDirectory(operationsDirectory), id);
}

/** The persisted-storage file of an app with operating directory `operatingDirectory` */
export const persistenceFile = (operatingDirectory: string) => path.join(operatingDirectory, ".persistence.jkv");
