import { hook_callback, with_meta_components } from '@matchlighter/meta_components';
import { observer } from 'mobx-react';
import { Component, createRef, useEffect, type ReactNode } from 'react';
import '../styles/confirm.css';
import { cancelFromEvent, syncModal } from './modal';

export interface ConfirmDialogProps {
    open: boolean;
    /** Names the target, e.g. "Clean up orphan old_presence?" */
    title: string;
    /** Caller-provided: what the action does */
    will: ReactNode;
    /** Caller-provided: what it leaves alone */
    wont?: ReactNode;
    /** Destructive CTA text, e.g. "Delete from HA" */
    confirmLabel: string;
    onConfirm: () => void;
    /** Cancel button, Esc, or scrim click. Owner should set `open` false. */
    onCancel: () => void;
}

let nextId = 0;

/** Destructive-confirm modal (design.md "Confirm dialog"); bottom sheet at phone width. Controlled via `open`. */
@with_meta_components
@observer
export class ConfirmDialog extends Component<ConfirmDialogProps> {
    private dialog = createRef<HTMLDialogElement>();
    private titleId = `confirm-title-${nextId++}`;

    @hook_callback(f => useEffect(f))
    syncOpen() {
        if (this.dialog.current) syncModal(this.dialog.current, this.props.open);
    }

    render() {
        const { title, will, wont, confirmLabel, onConfirm, onCancel } = this.props;
        return (
            <dialog
                ref={this.dialog}
                className="confirm"
                aria-labelledby={this.titleId}
                onCancel={e => cancelFromEvent(e, onCancel)}
                onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
            >
                <div className="confirm-body">
                    <h2 id={this.titleId} className="confirm-title">{title}</h2>
                    <div className="confirm-grid">
                        <b>Will</b><div>{will}</div>
                        {wont != null && <><b>Won't</b><div>{wont}</div></>}
                    </div>
                    <div className="confirm-warn">This can't be undone.</div>
                    <div className="confirm-actions">
                        <button type="button" className="btn" autoFocus onClick={onCancel}>Cancel</button>
                        <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
                    </div>
                </div>
            </dialog>
        );
    }
}
