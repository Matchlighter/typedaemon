import { hook_callback, with_meta_components } from '@matchlighter/meta_components';
import { mdiClose } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component, createRef, useEffect, type ReactNode } from 'react';
import '../styles/modal.css';
import { Icon } from './Icon';
import { cancelFromEvent, syncModal } from './modal';

export interface ModalProps {
    open: boolean;
    title: string;
    /** Close button, Esc or scrim click. Owner should set `open` false. */
    onClose: () => void;
    /** Pinned below the scrolling body (action buttons) */
    footer?: ReactNode;
    children: ReactNode;
}

let nextId = 0;

/**
 * General content dialog: titled, scrolling body, optional pinned footer; bottom sheet at phone width. Native `<dialog>` modal
 * (focus trap, inert background, Esc, focus returns to the opener). Controlled via `open`. For destructive confirms use `ConfirmDialog`.
 */
@with_meta_components
@observer
export class Modal extends Component<ModalProps> {
    private dialog = createRef<HTMLDialogElement>();
    private titleId = `modal-title-${nextId++}`;

    @hook_callback(f => useEffect(f))
    syncOpen() {
        if (this.dialog.current) syncModal(this.dialog.current, this.props.open);
    }

    render() {
        const { title, onClose, footer, children } = this.props;
        return (
            <dialog
                ref={this.dialog}
                className="modal"
                aria-modal="true"
                aria-labelledby={this.titleId}
                onCancel={e => cancelFromEvent(e, onClose)}
                onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            >
                <header className="modal-head">
                    <h2 id={this.titleId} className="modal-title">{title}</h2>
                    <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon path={mdiClose} size={18} /></button>
                </header>
                <div className="modal-body">{children}</div>
                {footer != null && <footer className="modal-foot">{footer}</footer>}
            </dialog>
        );
    }
}
