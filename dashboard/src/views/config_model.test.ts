import { describe, expect, it } from 'vitest';
import { defaultAnnotations, fileLocation } from './config_model';

describe('defaultAnnotations', () => {
    it('marks each default-sourced path as `default`, keyed the way the JSON viewer looks them up', () => {
        expect(defaultAnnotations([['export'], ['logging', 'level'], ['odd key']])).toEqual({
            '$.export': 'default', '$.logging.level': 'default', '$["odd key"]': 'default',
        });
    });
    it('is empty without defaults', () => {
        expect(defaultAnnotations([])).toEqual({});
    });
});

describe('fileLocation', () => {
    it('joins the file and line', () => {
        expect(fileLocation({ file: '/c/config.yaml', line: 31 })).toBe('/c/config.yaml : 31');
        expect(fileLocation({ file: '/c/config.yaml' })).toBe('/c/config.yaml');
        expect(fileLocation({})).toBeUndefined();
    });
});
