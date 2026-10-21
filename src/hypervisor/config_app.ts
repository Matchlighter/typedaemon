
import { merger } from "@matchlighter/common_library/data/config"
import type { Application } from "../runtime/application";
import { LogLevel } from "./logging";

export interface AppConfiguration {
    source: string;

    /** @internal The `source` as written in the config; `source` is replaced by the resolved path during normalization */
    declared_source?: string;

    human_name?: string;

    /** Only needed if using named, non-default export */
    export?: string;

    /** A unique id for the app. Defaults to the app name */
    uuid?: string;

    operating_directory?: string;

    watch?: {
        config?: boolean;
        source?: boolean;
        // debounce?: number;
    }

    logging?: {
        file?: string;
        level?: LogLevel;
        system_level?: LogLevel;
    }

    dependencies?: any;

    config?: any;
}

/**
 * Maps app `source` strings (as written in the TypeDaemon config) to that app's config type.
 *
 * Populated by the generated `.typedaemon/gen.apps.d.ts` via `declare module "@td"` augmentation.
 */
export interface AppRegistry {}

/**
 * Extract the config type of an app module's export `E`.
 *
 * Infers `C` from an `Application<C>` subclass, else `any`. (A module's exported `Config` type can't be seen from
 * `typeof import()`, so the generated registry references that separately when present.)
 */
export type AppConfigOf<M, E extends string = "default"> =
    M extends { [P in E]: abstract new (...args: any[]) => Application<infer C> } ? C :
    any;

/** Registered module of `K`, and its config type for default export (explicit `Config` export if present) */
type RegisteredModule<K extends keyof AppRegistry> = AppRegistry[K] extends { module: infer M } ? M : never;
type DefaultConfigOf<K extends keyof AppRegistry> =
    AppRegistry[K] extends { Config: infer C } ? C : AppConfigOf<RegisteredModule<K>>;

type AppConfigurationFor<K extends keyof AppRegistry> =
    Omit<AppConfiguration, "source" | "export" | "declared_source" | "config"> & {
        source: K;
    } & (
        // Default export: prefer an explicit `Config`
        | {
            export?: "default";
            /** Partial since a config may be built up from defaults and/or overridden at runtime */
            config?: Partial<DefaultConfigOf<K>>;
        }
        // Named exports: infer from the export
        | {
            [E in Exclude<keyof RegisteredModule<K> & string, "default">]: {
                export: E;
                config?: Partial<AppConfigOf<RegisteredModule<K>, E>>;
            }
        }[Exclude<keyof RegisteredModule<K> & string, "default">]
    )

/**
 * App entries for `Configuration.apps`. Once apps are registered in `AppRegistry`, `source` must be one of them
 * (and `config` is checked against that app's config type). Until then, the loose `AppConfiguration` is accepted.
 */
export type AppEntryConfiguration = [keyof AppRegistry] extends [never]
    ? AppConfiguration
    : { [K in keyof AppRegistry]: AppConfigurationFor<K> }[keyof AppRegistry];

export const defaultAppConfig: AppConfiguration = {
    source: null,
    export: null,
    logging: {},
    config: {},
}

export const AppConfigMerger = merger<AppConfiguration>({
    watch: merger(),
    logging: merger({
        
    }, (v) => (typeof v == 'string' ? { file: v } : v)),
})

