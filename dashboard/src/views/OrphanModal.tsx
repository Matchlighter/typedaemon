import { mount_effect, with_meta_components } from '@matchlighter/meta_components';
import type { OrphanLeftovers } from '@protocol';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ConfirmedAction } from '../stores/confirmed_action';
import { cleanupWill } from './orphan_model';
import { OrphanLeftoversView } from './OrphanLeftovers';

export interface OrphanModalProps {
    id: string;
    /** Route tab: `cleanup` opens with the confirmation already up */
    tab?: string;
    leftovers: OrphanLeftovers;
}

/**
 * Leftovers of an orphan app in a modal over the Apps page, with the one clean-up confirmation flow (`orphan.cleanup`).
 * Rendered by `AppRoute` for an orphan id; closing (and a finished cleanup) goes back to `#/apps`.
 */
@with_meta_components
@observer
export class OrphanModal extends Component<OrphanModalProps> {
    private cleaning = new ConfirmedAction<string>({
        call: id => app.connection.call('orphan.cleanup', { id }),
        failure: (_id, message) => `Cleanup failed; nothing more was changed. ${message}`,
        closeOnConfirm: true,
        done: () => this.close(),
    });

    private close = () => app.route.navigate('/apps');

    @mount_effect
    openRequestedConfirm() {
        if (this.props.tab === 'cleanup') this.cleaning.request(this.props.id);
    }

    render() {
        const { id, leftovers } = this.props;
        const will = cleanupWill(leftovers);
        return (
            <>
                <Modal open title={`Leftovers of ${id}`} onClose={this.close}
                    footer={<>
                        <button type="button" className="btn" onClick={this.close}>Close</button>
                        <button type="button" className="btn btn-danger-outline" disabled={this.cleaning.busy} onClick={() => this.cleaning.request(id)}>
                            {this.cleaning.busy ? 'Cleaning up…' : 'Clean up…'}
                        </button>
                    </>}>
                    <p className="orphan-note"><b className="mono">{id}</b> is no longer in the config, but it left these behind.</p>
                    <ActionError error={this.cleaning.error} />
                    <OrphanLeftoversView id={id} leftovers={leftovers} />
                </Modal>
                <ConfirmDialog
                    open={!!this.cleaning.confirming}
                    title={`Clean up orphan ${id}?`}
                    will={will}
                    wont={<>Touch the app's source files or the TypeDaemon config file, or remove Home Assistant entities it never registered with <code>auto_clean</code>.</>}
                    confirmLabel="Clean up"
                    onConfirm={() => void this.cleaning.confirm()}
                    onCancel={() => this.cleaning.cancel()}
                />
            </>
        );
    }
}
