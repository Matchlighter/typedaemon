import { autorun } from 'mobx';
import { describe, expect, it } from 'vitest';
import { PageChrome } from './page_chrome';

describe('PageChrome', () => {
    it('starts unclaimed', () => { expect(new PageChrome().current).toBeUndefined() });

    it('shows a claim and clears it on dispose', () => {
        const c = new PageChrome();
        const release = c.set({ title: 'Lights', backHref: '#/apps' });
        expect(c.current).toEqual({ title: 'Lights', backHref: '#/apps' });
        release();
        expect(c.current).toBeUndefined();
    });

    it('copies the state it is given', () => {
        const c = new PageChrome();
        const state = { title: 'A' };
        c.set(state);
        state.title = 'B';
        expect(c.current!.title).toBe('A');
    });

    it('lets the latest claim win; disposing a stale claim is a no-op', () => {
        const c = new PageChrome();
        const first = c.set({ title: 'First' });
        const second = c.set({ title: 'Second' });
        first();
        expect(c.current!.title).toBe('Second');
        second();
        expect(c.current).toBeUndefined();
    });

    it('works detached (autoBind) and is observable', () => {
        const c = new PageChrome();
        const { set } = c;
        const seen: (string | undefined)[] = [];
        const stop = autorun(() => seen.push(c.current?.title));
        const release = set({ title: 'X' });
        release();
        stop();
        expect(seen).toEqual([undefined, 'X', undefined]);
    });
});
