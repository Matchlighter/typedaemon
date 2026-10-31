import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import type { GallerySection } from '../gallery';
import { ConfirmDialog } from './ConfirmDialog';
import { with_meta_components } from '@matchlighter/meta_components';

const examples = [
    {
        label: 'Clean up orphan', title: 'Clean up orphan old_presence?', confirmLabel: 'Clean up',
        will: 'Run 2 destroyers: remove 3 entities from HA (binary_sensor.old_presence_home +2), then delete its operating dir and 12 storage keys.',
        wont: <>Touch <code>apps/old_presence/</code> source or <code>config.yaml</code>.</>,
    },
    {
        label: 'Delete storage key', title: 'Delete key "last_scene"?', confirmLabel: 'Delete key',
        will: 'Remove the key from the store.',
        wont: 'Change the running app, which keeps its in-memory value until it writes the key again or restarts.',
    },
];

@with_meta_components
@observer
class Demo extends Component {
    private state_ = observable({ open: -1, last: '' });
    render() {
        const s = this.state_;
        return (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {examples.map((ex, i) => <button key={i} type="button" className="btn" onClick={() => { s.open = i; }}>{ex.label}…</button>)}
                {s.last && <span className="lbl">{s.last}</span>}
                {examples.map((ex, i) => (
                    <ConfirmDialog key={i} open={s.open === i} title={ex.title} will={ex.will} wont={ex.wont} confirmLabel={ex.confirmLabel}
                        onConfirm={() => { s.open = -1; s.last = `confirmed: ${ex.label}`; }}
                        onCancel={() => { s.open = -1; s.last = `cancelled: ${ex.label}`; }} />
                ))}
            </div>
        );
    }
}

export default { title: 'Confirm dialog', render: () => <Demo /> } satisfies GallerySection;
