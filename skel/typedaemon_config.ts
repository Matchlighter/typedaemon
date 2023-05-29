
import type { Configuration } from "@td";

export default async function (): Promise<Configuration> {
    return {
        logging: {
            system: "debug",
        },
        plugins: {
            home_assistant: {
                type: "home_assistant",

                // Connection Info: (Optional if installed via Home Assistant Supervisor)
                // url: "",
                // access_token: "",
            },
            mqtt: {
                type: "mqtt",

                // Connection Info: (Optional if installed via Home Assistant Supervisor)
                // host: "",
                // username: "",
                // password: "",
            }
        },
        apps: {
            lite_example: {
                source: "applications/lite_app.ts",
                config: {
                    some_option: "Lite Mode",
                },
            },
            full_example: {
                source: "applications/full_app",
                config: {
                    some_option: "Full Mode",
                },
            },
        }
    }
}
