
import * as jsyaml from "js-yaml";

// TODO Allow HA style !include, etc
export const HA_YAML_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend([
    new jsyaml.Type('!secret', {
        kind: 'scalar',
        construct: (data: string) => 'secret ' + data,
    }),
])

export function parseYaml(source: string, { filename }: { filename?: string } = {}) {
    return jsyaml.load(source, {
        schema: HA_YAML_SCHEMA,
        filename,
    });
}
