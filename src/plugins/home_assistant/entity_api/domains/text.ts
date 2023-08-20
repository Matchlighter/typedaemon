
import { EntityClass, EntityOptionsCommon, EntityOptionsCommonW, HATemplate, discoveryPassOptions } from "./base";

export interface TextOptions extends EntityOptionsCommon, EntityOptionsCommonW {
    /** Defines a template to generate the payload to send to command_topic. */
    command_template?: HATemplate;

    /** The maximum size of a text being set or received (maximum is 255). */
    max?: number;

    /** The minimum size of a text being set or received. */
    min?: number;

    /** The mode off the text entity. Must be either text or password. */
    mode?: "text" | "password";

    /** A valid regular expression the text being set or received must match with. */
    pattern?: string;
}

export class TDText extends EntityClass<string, {}, TextOptions> {
    static domain = "text";

    protected discovery_data() {
        const dd = super.discovery_data();
        Object.assign(dd, {
            ...discoveryPassOptions(this.options, [
                "min",
                "max",
                "mode",
                "pattern",
                "command_template",
            ]),
        })
        return dd;
    }

    protected async handle_command(payload: any) {
        // TODO
    }
}
