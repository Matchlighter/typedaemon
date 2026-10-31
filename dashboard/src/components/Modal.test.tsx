// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDialog } from '../test/dialog';
import { Modal } from './Modal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
stubDialog();

let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) });
afterEach(() => { act(() => root.unmount()); host.remove() });
const render = (open: boolean, onClose = vi.fn()) => { act(() => root.render(<Modal open={open} title="T" onClose={onClose} footer={<i>f</i>}><b>body</b></Modal>)); return onClose };

describe('Modal', () => {
    it('is a labelled modal dialog following `open`', () => {
        render(false);
        const d = host.querySelector('dialog')!;
        expect(d.hasAttribute('open')).toBe(false);
        render(true);
        expect(d.hasAttribute('open')).toBe(true);
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(d.getAttribute('aria-labelledby')).toBe(d.querySelector('h2')!.id);
        expect(d.textContent).toContain('body');
        expect(d.querySelector('.modal-foot')!.textContent).toBe('f');
    });

    it('asks the owner to close on the X, Esc and scrim click', () => {
        const onClose = render(true);
        const d = host.querySelector('dialog')!;
        act(() => { (d.querySelector('[aria-label="Close"]') as HTMLElement).click() });
        act(() => { d.dispatchEvent(new Event('cancel', { cancelable: true })) });
        act(() => { d.click() });
        expect(onClose).toHaveBeenCalledTimes(3);
    });
});
