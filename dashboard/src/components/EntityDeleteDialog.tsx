import { observer } from 'mobx-react';
import { Component } from 'react';
import { entityLabel } from '../views/entities_model';
import type { ConfirmedAction } from '../stores/confirmed_action';
import type { DeletableEntity } from '../views/entity_deletion';
import { ConfirmDialog } from './ConfirmDialog';

/** "Delete from HA" button of an unlinked entity's row: asks `deletion` to confirm */
@observer
export class EntityDeleteButton extends Component<{ deletion: ConfirmedAction<DeletableEntity>; row: DeletableEntity }> {
    render() {
        const { deletion, row } = this.props;
        return <button type="button" className="btn btn-sm btn-danger-outline" disabled={deletion.busy} onClick={() => deletion.request(row)}>Delete from HA</button>;
    }
}

/** Confirm dialog of the "Delete from HA" flow (`entityDeletion`) */
@observer
export class EntityDeleteDialog extends Component<{ deletion: ConfirmedAction<DeletableEntity> }> {
    render() {
        const { deletion } = this.props;
        const target = deletion.confirming;
        return (
            <ConfirmDialog
                open={!!target}
                title={target ? `Delete ${entityLabel(target)} from Home Assistant?` : ''}
                will={<>Remove the entity from Home Assistant and from this app's auto-clean registry.</>}
                wont={<>Touch this app's code or its other entities. The app can register it again on its next start.</>}
                confirmLabel="Delete from HA"
                onConfirm={() => void deletion.confirm()}
                onCancel={() => deletion.cancel()}
            />
        );
    }
}
