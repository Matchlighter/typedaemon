import type { OrphanLeftovers } from '@protocol';
import { formatBytes, plural } from '../format';
import { entityLabel, filterEntities } from './entities_model';

/** Destroyer (server: `HAEntititesDestroyer`) that removes the entities in the autoclean registry from HA */
const ENTITY_DESTROYER = 'HAEntities';

/**
 * What a cleanup will do, worded from the leftovers on screen. Cleanup runs every destroyer, then deletes the operating
 * directory; the entities are the ones the destroyers remove from Home Assistant.
 */
export function cleanupPlan(l: OrphanLeftovers): { destroyers?: string; files: string } {
    let destroyers: string | undefined;
    if (l.destroyers.length) {
        const types = [...new Set(l.destroyers.map(d => d.type))].join(', ');
        destroyers = `Run ${plural(l.destroyers.length, 'destroyer', 'destroyers')} (${types})`;
        if (l.entities.length && l.destroyers.some(d => d.type === ENTITY_DESTROYER)) {
            const [first] = filterEntities(l.entities, {});
            const more = l.entities.length - 1;
            destroyers += `: remove ${plural(l.entities.length, 'entity', 'entities')} from Home Assistant (${entityLabel(first)}${more ? ` +${more}` : ''})`;
        }
    }
    const keys = l.storage.length ? ` and its ${plural(l.storage.length, 'stored key', 'stored keys')}` : '';
    return { destroyers, files: `delete its operating directory (${l.dir.path}: ${formatBytes(l.dir.bytes)} in ${plural(l.dir.files, 'file', 'files')})${keys}` };
}

/** `cleanupPlan` as one sentence (the confirm dialog's "Will") */
export function cleanupWill(l: OrphanLeftovers): string {
    const plan = cleanupPlan(l);
    return plan.destroyers ? `${plan.destroyers}, then ${plan.files}.` : `${plan.files[0].toUpperCase()}${plan.files.slice(1)}.`;
}
