import { mdiDotsVertical } from '@mdi/js';
import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';
import '../styles/row_menu.css';

export interface RowMenuItem {
    key: string;
    label: string;
    /** Link item (otherwise a button running `onSelect`) */
    href?: string;
    onSelect?: () => void;
}

export interface RowMenuProps {
    /** Accessible name of the trigger, e.g. "More actions for lights" */
    label: string;
    items: RowMenuItem[];
}

/** Kebab icon button opening a small menu; closes on pick, outside click or Escape. */
export class RowMenu extends Component<RowMenuProps> {
    state = { open: false };
    private root: HTMLSpanElement | null = null;

    private outside = (e: Event) => { if (!this.root?.contains(e.target as Node)) this.close() };
    private key = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close() };
    private close = () => this.setState({ open: false });

    componentDidUpdate(_: RowMenuProps, prev: { open: boolean }) {
        if (this.state.open === prev.open) return;
        if (this.state.open) {
            document.addEventListener('mousedown', this.outside);
            document.addEventListener('keydown', this.key);
        } else {
            this.unlisten();
        }
    }
    componentWillUnmount() { this.unlisten() }

    private unlisten() {
        document.removeEventListener('mousedown', this.outside);
        document.removeEventListener('keydown', this.key);
    }

    render(): ReactNode {
        const { label, items } = this.props;
        const { open } = this.state;
        return (
            <span className="row-menu" ref={el => { this.root = el }}>
                <button type="button" className="icon-btn" aria-label={label} title="More actions" aria-haspopup="menu" aria-expanded={open}
                    onClick={() => this.setState({ open: !open })}>
                    <Icon path={mdiDotsVertical} size={16} />
                </button>
                {open && (
                    <div className="row-menu-pop" role="menu">
                        {items.map(i => i.href
                            ? <a key={i.key} role="menuitem" href={i.href} onClick={this.close}>{i.label}</a>
                            : <button key={i.key} type="button" role="menuitem" onClick={() => { this.close(); i.onSelect?.() }}>{i.label}</button>)}
                    </div>
                )}
            </span>
        );
    }
}
