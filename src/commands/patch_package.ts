import { passthroughCommand } from "../common/cli_helpers";
import { PATCH_PACKAGE_BIN } from "../hypervisor/packages";

export default passthroughCommand("patch-package", PATCH_PACKAGE_BIN, "Run patch-package in the current directory");
