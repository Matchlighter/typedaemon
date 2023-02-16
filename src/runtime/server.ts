
import * as process from 'process';

import { Application } from './application';

const arg = process.argv.slice(2);
const [app_id, application_path] = arg;

const runner = new Application(app_id, application_path);
runner.start();
