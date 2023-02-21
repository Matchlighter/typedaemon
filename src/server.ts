
import * as process from 'process';

import { Application } from './runtime/application';
import { Hypervisor } from './hypervisor/hypervisor';

const arg = process.argv.slice(2);
const [app_id, application_path] = arg;

const hv = new Hypervisor({
    working_directory: application_path,
})

hv.start();
