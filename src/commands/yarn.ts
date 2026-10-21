import { passthroughCommand } from "../common/cli_helpers";
import { YARN_BIN } from "../hypervisor/packages";

export default passthroughCommand("yarn", YARN_BIN, "Run yarn in the current directory");
