
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
                access_token: "",
            },
            mqtt: {
                type: "mqtt",
                url: "mqtt://",
                host: "",
                username: "",
                password: "",
            }
        },
        apps: {
            // test: {
            //     source: "applications/lite_app.ts",
            //     config: {
            //         bob: 7
            //     }
            // },
            big: {
                source: "applications/full_app",
                config: {
                    bob: 5
                }
            },
        }
    }
}
