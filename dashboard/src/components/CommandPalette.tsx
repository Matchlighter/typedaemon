import { hook_callback, mount_effect, with_meta_components } from '@matchlighter/meta_components';
import { mdiMagnify } from '@mdi/js';
import { action, observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component, createRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import '../styles/palette.css';
import { Icon } from './Icon';
import { cancelFromEvent, syncModal } from './modal';
import { matchRange, moveActive, searchProviders, type PaletteProvider, type PaletteResult } from './palette_model';

export type { PaletteProvider, PaletteResult } from './palette_model';

/** Dispatched on `document` by `openPalette()`; the mounted palette opens */
const OPEN_EVENT = 'td:open-palette';

/** Open the palette from anywhere (e.g. a header search button) */
export const openPalette = () => document.dispatchEvent(new Event(OPEN_EVENT));

/** Ctrl+K / Cmd+K */
export function isPaletteHotkey(e: { key: string; ctrlKey: boolean; metaKey: boolean }) {
    return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
}

export interface CommandPaletteProps {
    /** Result sources, shown as groups in this order */
    providers: PaletteProvider[];
    /** Called when the palette opens/closes (e.g. to subscribe data sources only while it is open) */
    onOpenChange?: (open: boolean) => void;
    /** Data sources have not synced yet: shown instead of `No results` */
    loading?: boolean;
}

let nextId = 0;

/** Runs after every render (meta wrapper re-renders on observer/setState updates too). */
const render_effect = hook_callback<() => void>(f => useEffect(f));

/** Ctrl/Cmd+K palette. Owns its open state and the global hotkey; mount once near the app root. */
@with_meta_components
@observer
export class CommandPalette extends Component<CommandPaletteProps> {
    private id = `pal-${nextId++}`;
    private ui = observable({ open: false, query: '', active: 0 });

    private get results() { return searchProviders(this.props.providers, this.ui.query); }

    @mount_effect
    listenHotkey() {
        const onKey = (e: KeyboardEvent) => {
            if (!isPaletteHotkey(e)) return;
            e.preventDefault();
            this.setOpen(!this.ui.open);
        };
        const onOpen = () => { if (!this.ui.open) this.setOpen(true); };
        document.addEventListener('keydown', onKey);
        document.addEventListener(OPEN_EVENT, onOpen);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener(OPEN_EVENT, onOpen); };
    }

    private dialogRef = createRef<HTMLDialogElement>();

    @render_effect
    syncDialog() { if (this.dialogRef.current) syncModal(this.dialogRef.current, this.ui.open); }

    @action private setOpen(open: boolean) {
        this.ui.open = open;
        this.ui.query = '';
        this.ui.active = 0;
        this.props.onOpenChange?.(open);
    }

    @action private setQuery(q: string) {
        this.ui.query = q;
        this.ui.active = 0;
    }

    @action private choose(item: PaletteResult | undefined) {
        if (!item) return;
        this.setOpen(false);
        item.run();
    }

    private onKeyDown = (e: ReactKeyboardEvent) => {
        const { flat } = this.results;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            action(() => { this.ui.active = moveActive(this.ui.active, e.key === 'ArrowDown' ? 1 : -1, flat.length); })();
        } else if (e.key === 'Enter') { e.preventDefault(); this.choose(flat[this.ui.active]); }
    };

    private renderLabel(item: PaletteResult) {
        if (item.content != null) return item.content;
        const r = matchRange(item.label, this.ui.query);
        if (!r || r[0] === r[1]) return item.label;
        return <>{item.label.slice(0, r[0])}<mark>{item.label.slice(r[0], r[1])}</mark>{item.label.slice(r[1])}</>;
    }

    render() {
        const { groups, flat } = this.results;
        const activeItem = flat[this.ui.active];
        let idx = 0;
        return (
            <dialog ref={this.dialogRef} className="pal card" aria-label="Command palette"
                onCancel={e => cancelFromEvent(e, () => this.setOpen(false))}
                onClick={e => { if (e.target === e.currentTarget) this.setOpen(false); }}>
                {this.ui.open && <>
                    <div className="pal-input">
                        <Icon path={mdiMagnify} size={18} />
                        <input autoFocus type="text" role="combobox" aria-expanded="true" aria-controls={`${this.id}-list`}
                            aria-activedescendant={activeItem ? `${this.id}-${activeItem.id}` : undefined} aria-autocomplete="list"
                            placeholder="Search entities, storage keys, actions…" autoComplete="off" spellCheck={false}
                            value={this.ui.query} onChange={e => this.setQuery(e.target.value)} onKeyDown={this.onKeyDown} />
                        <kbd>Esc</kbd>
                    </div>
                    <div className="pal-list" id={`${this.id}-list`} role="listbox">
                        {flat.length === 0 && <div className="pal-empty">{this.props.loading ? 'Syncing…' : 'No results'}</div>}
                        {groups.map(g => (
                            <div key={g.id} role="group" aria-label={g.title}>
                                <div className="lbl pal-group-lbl">{g.title}</div>
                                {g.items.map(item => {
                                    const i = idx++;
                                    return (
                                        <div key={item.id} id={`${this.id}-${item.id}`} role="option" aria-selected={i === this.ui.active}
                                            className="pal-row" ref={el => { if (el && i === this.ui.active) el.scrollIntoView?.({ block: 'nearest' }); }}
                                            onMouseMove={() => { if (this.ui.active !== i) action(() => { this.ui.active = i; })(); }}
                                            onClick={() => this.choose(item)}>
                                            <span className="mono pal-label">{this.renderLabel(item)}</span>
                                            {item.sublabel && <span className="pal-sub">{item.sublabel}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </>}
            </dialog>
        );
    }
}
