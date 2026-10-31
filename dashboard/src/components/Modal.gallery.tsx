import { with_meta_components } from '@matchlighter/meta_components';
import { observable } from 'mobx';
import { observer } from 'mobx-react';
import { Component } from 'react';
import type { GallerySection } from '../gallery';
import { Modal } from './Modal';

@with_meta_components
@observer
class Demo extends Component {
    private s = observable({ open: false });
    render() {
        const s = this.s;
        return (
            <>
                <button type="button" className="btn" onClick={() => { s.open = true }}>Open modal…</button>
                <Modal open={s.open} title="Leftovers of old_presence" onClose={() => { s.open = false }}
                    footer={<button type="button" className="btn" onClick={() => { s.open = false }}>Close</button>}>
                    {Array.from({ length: 12 }, (_, i) => <p key={i}>Scrolling body paragraph {i + 1}.</p>)}
                </Modal>
            </>
        );
    }
}

export default { title: 'Modal', render: () => <Demo /> } satisfies GallerySection;
