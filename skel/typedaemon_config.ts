
import type { Configuration } from "@td";

export default async function (): Promise<Configuration> {
    return {
        logging: {
            system: "debug",
        },
        plugins: {
            home_assistant: {
                type: "home_assistant",
                url: "",
                access_token: "", // Optional if installed via Home Assistent Supervisor
            },
            mqtt: {
                type: "mqtt",
                host: "",
                username: "",
                password: "",
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
