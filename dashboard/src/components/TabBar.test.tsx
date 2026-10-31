// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TabBar, visibleTab } from './TabBar';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('visibleTab', () => {
    const tabs = [{ key: 'a' }, { key: 'b' }] as const;
    it('falls back to the first tab', () => {
        expect(visibleTab(tabs, 'b')).toBe('b');
        expect(visibleTab(tabs, 'zzz')).toBe('a');
        expect(visibleTab(tabs, undefined)).toBe('a');
    });
});

describe('TabBar', () => {
    it('links every tab, marks the current one, and shows count and flag', () => {
        const host = document.createElement('div');
        act(() => createRoot(host).render(
            <TabBar label="Sections" current="b" hrefFor={k => `#/x/${k}`}
                tabs={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta', count: 3, flag: '+1 odd' }]} />));
        const links = [...host.querySelectorAll('a')];
        expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe('Sections');
        expect(links.map(a => a.getAttribute('href'))).toEqual(['#/x/a', '#/x/b']);
        expect(links.map(a => a.getAttribute('aria-current'))).toEqual([null, 'page']);
        expect(links[1].querySelector('.cnt')!.textContent).toBe('3');
        expect(links[1].querySelector('.cnt-w')!.textContent).toBe('+1 odd');
        expect(links[0].querySelector('.cnt')).toBeNull();
    });
});
