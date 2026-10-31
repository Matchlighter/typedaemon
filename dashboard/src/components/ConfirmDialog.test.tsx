import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { cancelFromEvent, syncModal } from './modal';

const base = {
    open: true,
    title: 'Clean up orphan old_presence?',
    will: 'Remove 3 entities from HA.',
    wont: 'Touch apps/old_presence/ source.',
    confirmLabel: 'Clean up',
    onConfirm: () => {},
    onCancel: () => {},
};
const render = (p: Partial<typeof base> = {}) => renderToString(<ConfirmDialog {...base} {...p} />);

describe('ConfirmDialog markup', () => {
    it('is a native dialog labelled by a title naming the target', () => {
        const out = render();
        expect(out).toMatch(/^<dialog/);
        expect(out).toContain('Clean up orphan old_presence?');
        const id = /aria-labelledby="([^"]+)"/.exec(out)![1];
        expect(out).toMatch(new RegExp(`<h2[^>]*id="${id}"`));
    });

    it('shows caller-provided Will and Won\'t content under explicit labels', () => {
        const out = render();
        expect(out).toContain('Will');
        expect(out).toContain('Remove 3 entities from HA.');
        expect(out).toContain('Won&#x27;t');
        expect(out).toContain('Touch apps/old_presence/ source.');
    });

    it('accepts rich (node) content for Will', () => {
        expect(render({ will: <b>bold thing</b> as any })).toContain('<b>bold thing</b>');
    });

    it('omits the Won\'t row when not given', () => {
        expect(render({ wont: undefined })).not.toContain('Won&#x27;t');
    });

    it('warns it cannot be undone, with Cancel and a destructive CTA', () => {
        const out = render();
        expect(out).toContain('This can&#x27;t be undone.');
        expect(out).toContain('>Cancel<');
        expect(out).toMatch(/class="btn btn-danger"[^>]*>Clean up</);
    });

    it('does not set the static open attribute (opened via showModal only)', () => {
        expect(render()).not.toMatch(/<dialog[^>]*\sopen/);
    });
});

describe('syncModal', () => {
    const fake = (isOpen = false) => {
        const d = { open: isOpen, showModal: vi.fn(() => { d.open = true; }), close: vi.fn(() => { d.open = false; }) };
        return d;
    };

    it('opens modally when requested and closed', () => {
        const d = fake();
        syncModal(d, true);
        expect(d.showModal).toHaveBeenCalledOnce();
    });

    it('does not re-open an already open dialog', () => {
        const d = fake(true);
        syncModal(d, true);
        expect(d.showModal).not.toHaveBeenCalled();
    });

    it('closes when open is withdrawn', () => {
        const d = fake(true);
        syncModal(d, false);
        expect(d.close).toHaveBeenCalledOnce();
    });

    it('does nothing when closed and not requested', () => {
        const d = fake();
        syncModal(d, false);
        expect(d.close).not.toHaveBeenCalled();
    });
});

describe('cancelFromEvent (Esc)', () => {
    it('prevents native close and defers to onCancel so the owner controls state', () => {
        const onCancel = vi.fn();
        const e = { preventDefault: vi.fn() };
        cancelFromEvent(e, onCancel);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
