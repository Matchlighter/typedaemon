
import { current } from "../hypervisor/current";

export const app_current = {
    get config() {
        return current.application?.app_config;
    },
    /** DO NOT USE! Provides a handle to the internal ApplicationInstance object. */
    get _internal_application_instance() {
        return current.application;
    },
}
