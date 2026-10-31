import type { EntityRow } from '@protocol';
import { app } from '../app';
import { ConfirmedAction } from '../stores/confirmed_action';
import { entityLabel } from './entities_model';

/** What `entity.delete` needs: the owning app and the app-local registry key */
export interface DeletableEntity extends EntityRow {
    /** Omit when the row's own `key` is the app-local one (rows of a single app) */
    app?: string;
    entityKey?: string;
}

/** The "Delete from HA" flow for unlinked entities, shared by every view that lists them. `appId`: owner of the rows when they don't say (a single app's list) */
export const entityDeletion = (appId?: string) => new ConfirmedAction<DeletableEntity>({
    call: t => app.connection.call('entity.delete', { app: t.app ?? appId!, key: t.entityKey ?? t.key }),
    failure: (t, message) => `Couldn't delete ${entityLabel(t)}: ${message}`,
});
