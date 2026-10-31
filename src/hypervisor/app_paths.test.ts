import * as path from 'path';
import { appDirectory, persistenceFile } from './app_paths';

describe('app_paths', () => {
    it('places apps below app_environments', () => {
        expect(appDirectory('/ops', 'a')).toBe(path.join('/ops', 'app_environments', 'a'));
        expect(persistenceFile('/x')).toBe(path.join('/x', '.persistence.jkv'));
    });
    it.each(['', '.', '..', 'a/b', '../x'])('rejects %j', id => {
        expect(() => appDirectory('/ops', id)).toThrow(/Invalid app id/);
    });
});
