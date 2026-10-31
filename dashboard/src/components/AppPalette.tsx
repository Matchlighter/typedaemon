import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from '../app';
import { CommandPalette } from './CommandPalette';
import { ActionError } from './ActionError';
import { ConfirmDialog } from './ConfirmDialog';
import { PaletteSources } from './palette_sources';

/** The app-wide Ctrl/Cmd+K palette: apps, app actions, entities and storage keys. Mount once in the shell. */
@observer
export class AppPalette extends Component {
    private sources = new PaletteSources(app.connection, app.route);

    render() {
        const { action, loading } = this.sources;
        const pending = action.confirming;
        return (
            <>
                <CommandPalette providers={this.sources.providers} onOpenChange={this.sources.setOpen} loading={loading} />
                <ActionError error={action.error} className="pal-toast" onClick={() => action.dismiss()} />
                <ConfirmDialog
                    open={!!pending}
                    title={pending ? `Stop ${pending.appId}?` : ''}
                    will={<>Stop the app. It stays stopped until started again or the next config reload.</>}
                    confirmLabel="Stop app"
                    onConfirm={() => void action.confirm()}
                    onCancel={() => action.cancel()}
                />
            </>
        );
    }
}
