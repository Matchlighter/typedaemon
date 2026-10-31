import { createDomainLogger } from './logging';
import { logTap } from './log_tap';

describe('createDomainLogger tap', () => {
    it('feeds the log tap with the logger\'s source and channel when it has a source', () => {
        const logger = createDomainLogger({ level: 'debug', domain: 'App: tapped', source: { kind: 'app', id: 'tapped' }, channel: 'user' });
        logger.logMessage('info', ['hello', 'world']);
        logger.logMessage('lifecycle', ['Started']);
        const recs = logTap.history({ sources: [{ kind: 'app', id: 'tapped' }] });
        expect(recs.map(r => [r.level, r.message, r.channel])).toEqual([['info', 'hello world', 'user'], ['lifecycle', 'Started', 'user']]);
        logger.close();
    });

    it('respects the logger level like the other transports do', () => {
        const logger = createDomainLogger({ level: 'warn', domain: 'x', source: { kind: 'app', id: 'quiet' }, channel: 'manager' });
        logger.logMessage('debug', ['hidden']);
        logger.logMessage('error', ['shown']);
        expect(logTap.history({ sources: [{ kind: 'app', id: 'quiet' }] }).map(r => r.message)).toEqual(['shown']);
        logger.close();
    });
});
