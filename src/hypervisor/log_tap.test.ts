import { LogTap, TapTransport, type LogRecord, type LogSource } from './log_tap';

const app = (id: string) => ({ kind: 'app', id }) as const;
const rec = (source: LogSource = app('a'), over: Partial<Omit<LogRecord, 'id'>> = {}) => ({ ts: 1, level: 'info', source, channel: 'user' as const, message: 'm', ...over });

describe('LogTap', () => {
    it('assigns increasing ids and returns entries oldest first', () => {
        const tap = new LogTap();
        tap.append(rec(app('a'), { message: '1' }));
        tap.append(rec(app('b'), { message: '2' }));
        const all = tap.history();
        expect(all.map(r => r.message)).toEqual(['1', '2']);
        expect(all[1].id).toBeGreaterThan(all[0].id);
    });

    it('filters history by source, or serves every source when none is given', () => {
        const tap = new LogTap();
        tap.append(rec(app('a')));
        tap.append(rec(app('b')));
        tap.append(rec({ kind: 'system', id: 'hypervisor' }));
        expect(tap.history({ sources: [app('b')] }).map(r => r.source.id)).toEqual(['b']);
        expect(tap.history({ sources: [app('a'), { kind: 'system', id: 'hypervisor' }] })).toHaveLength(2);
        expect(tap.history()).toHaveLength(3);
    });

    it('limit keeps the newest entries across sources', () => {
        const tap = new LogTap();
        for (let i = 0; i < 6; i++) tap.append(rec(app(i % 2 ? 'a' : 'b'), { message: String(i) }));
        expect(tap.history({ limit: 3 }).map(r => r.message)).toEqual(['3', '4', '5']);
    });

    it('bounds memory per source: a noisy source cannot evict a quiet one', () => {
        const tap = new LogTap({ perSource: 3 });
        tap.append(rec(app('quiet'), { message: 'q' }));
        for (let i = 0; i < 10; i++) tap.append(rec(app('noisy'), { message: String(i) }));
        expect(tap.history({ sources: [app('noisy')] }).map(r => r.message)).toEqual(['7', '8', '9']);
        expect(tap.history({ sources: [app('quiet')] }).map(r => r.message)).toEqual(['q']);
    });

    it('findLast: newest match after a mark, optionally per source', () => {
        const tap = new LogTap();
        tap.append(rec(app('a'), { level: 'error', message: 'old' }));
        const mark = tap.lastId;
        expect(tap.findLast({ afterId: mark })).toBeUndefined();
        tap.append(rec(app('a'), { level: 'error', message: 'e1' }));
        tap.append(rec(app('b'), { level: 'error', message: 'other app' }));
        tap.append(rec(app('a'), { level: 'info', message: 'later info' }));
        const isError = (r: LogRecord) => r.level === 'error';
        expect(tap.findLast({ sources: [app('a')], afterId: mark, match: isError })!.message).toBe('e1');
        expect(tap.findLast({ afterId: mark, match: isError })!.message).toBe('other app');
        expect(tap.findLast({ sources: [app('a')], match: isError })!.message).toBe('e1');
        expect(tap.findLast({ sources: [app('c')] })).toBeUndefined();
    });

    it('bounds memory per source by bytes, keeping the newest', () => {
        const tap = new LogTap({ maxBytesPerSource: 100 });
        for (let i = 0; i < 10; i++) tap.append(rec(app('a'), { message: String(i).repeat(30) }));
        const kept = tap.history();
        expect(kept.map(r => r.message[0])).toEqual(['7', '8', '9']);
        expect(kept.length * 30).toBeLessThanOrEqual(100);
    });

    it('always keeps the newest record, even if it alone exceeds the byte budget', () => {
        const tap = new LogTap({ maxBytesPerSource: 5, maxMessage: 1000 });
        tap.append(rec(app('a'), { message: 'x'.repeat(50) }));
        expect(tap.history()).toHaveLength(1);
    });

    it('drop() forgets a source\'s buffer, leaving others; later logs start fresh', () => {
        const tap = new LogTap();
        tap.append(rec(app('a')));
        tap.append(rec(app('b')));
        tap.drop(app('a'));
        expect(tap.history().map(r => r.source.id)).toEqual(['b']);
        tap.append(rec(app('a'), { message: 'again' }));
        expect(tap.history({ sources: [app('a')] }).map(r => r.message)).toEqual(['again']);
    });

    it('truncates huge messages', () => {
        const tap = new LogTap({ maxMessage: 10 });
        tap.append(rec(app('a'), { message: 'x'.repeat(50) }));
        expect(tap.history()[0].message.length).toBeLessThanOrEqual(11 + 20);
        expect(tap.history()[0].message.startsWith('xxxxxxxxxx')).toBe(true);
    });

    it('notifies listeners of new entries (all, or by source) until they unsubscribe', () => {
        const tap = new LogTap();
        const seen: string[] = [];
        const off = tap.on(e => seen.push(e.source.id));
        const seenB: string[] = [];
        tap.on(e => seenB.push(e.message), { sources: [app('b')] });
        tap.append(rec(app('a')));
        tap.append(rec(app('b'), { message: 'bb' }));
        off();
        tap.append(rec(app('a')));
        expect(seen).toEqual(['a', 'b']);
        expect(seenB).toEqual(['bb']);
    });
});

describe('TapTransport', () => {
    const log = (t: TapTransport, info: any) => new Promise<void>(r => t.log(info, r));

    it('records winston entries: ansi stripped, ISO timestamp as epoch ms, channel and source from the logger', async () => {
        const tap = new LogTap();
        const t = new TapTransport(tap, app('lights'), 'manager');
        await log(t, { level: 'warn', message: '\u001b[32mCompiling\u001b[39m x', timestamp: '2026-10-19T14:06:41.007-06:00' });
        expect(tap.history()).toEqual([expect.objectContaining({
            ts: Date.parse('2026-10-19T14:06:41.007-06:00'), level: 'warn', message: 'Compiling x', source: app('lights'), channel: 'manager',
        })]);
    });

    it('falls back to now when the entry has no timestamp', async () => {
        const tap = new LogTap();
        const before = Date.now();
        await log(new TapTransport(tap, app('a'), 'user'), { level: 'info', message: 'x' });
        expect(tap.history()[0].ts).toBeGreaterThanOrEqual(before);
    });
});
