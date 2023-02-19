
import * as jsyaml from "js-yaml";

// TODO Allow HA style !include, !secret, etc
export const HA_YAML_SCHEMA = new jsyaml.Schema([
    new jsyaml.Type('!secret', {
        kind: 'scalar',
        construct: function (data) {
            return data.map(function (string) { return 'secret ' + string; });
        },
    }),
])
