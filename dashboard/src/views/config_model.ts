import type { AppConfigSnapshot } from '@protocol';
import { childPath } from '../components/json_model';

/** JSON viewer annotations for the paths whose value came from defaults rather than the config file */
export const defaultAnnotations = (defaults: AppConfigSnapshot['defaults']): Record<string, string> =>
    Object.fromEntries(defaults.map(p => [p.reduce(childPath, '$'), 'default']));

/** `<file> : <line>` as shown beside the config; undefined if the file isn't known */
export const fileLocation = ({ file, line }: Pick<AppConfigSnapshot, 'file' | 'line'>) =>
    file === undefined ? undefined : line === undefined ? file : `${file} : ${line}`;
