// @vitest-environment happy-dom
import { store, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flash } from './flash';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

@with_meta_components
@observer
class Probe extends Component<{ token?: unknown }> {
    @store flash = new Flash(() => this.props.token, 1500);
    componentDidUpdate() { this.flash.check(); }
    render() { return <span id="p">{String(this.flash.active)}</span>; }
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const text = () => host.querySelector('#p')!.textContent;
const render = (token?: unknown) => act(() => root.render(<Probe token={token} />));

beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

describe('Flash', () => {
    it('does not flash on mount, even with a token', () => {
        render(1);
        expect(text()).toBe('false');
    });

    it('flashes when token changes, clears after the duration', () => {
        render(1);
        render(2);
        expect(text()).toBe('true');
        act(() => { vi.advanceTimersByTime(1499); });
        expect(text()).toBe('true');
        act(() => { vi.advanceTimersByTime(2); });
        expect(text()).toBe('false');
    });

    it('same token does not retrigger; new token restarts the timer', () => {
        render(1);
        render(2);
        act(() => { vi.advanceTimersByTime(1000); });
        render(2);
        render(3);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(text()).toBe('true');
        act(() => { vi.advanceTimersByTime(600); });
        expect(text()).toBe('false');
    });

    it('undefined token never flashes', () => {
        render(undefined);
        render(undefined);
        expect(text()).toBe('false');
    });

    it('stops its timer on unmount', () => {
        render(1);
        render(2);
        act(() => root.unmount());
        expect(vi.getTimerCount()).toBe(0);
        root = createRoot(host);
    });
});
