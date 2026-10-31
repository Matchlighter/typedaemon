import {
    mdiBell, mdiCalendar, mdiCog, mdiFan, mdiFormatListBulleted, mdiGauge, mdiGestureTap, mdiLightbulb, mdiLock,
    mdiNumeric, mdiOpenInNew, mdiPlayCircleOutline, mdiRadioboxMarked, mdiShapeOutline, mdiThermostat, mdiToggleSwitch,
} from '@mdi/js';
import type { ReactNode } from 'react';
import '../styles/entity.css';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { StateBadge } from './StateBadge';

const DOMAIN_ICONS: Record<string, string> = {
    sensor: mdiGauge,
    binary_sensor: mdiRadioboxMarked,
    switch: mdiToggleSwitch,
    light: mdiLightbulb,
    select: mdiFormatListBulleted,
    number: mdiNumeric,
    button: mdiGestureTap,
    lock: mdiLock,
    fan: mdiFan,
    climate: mdiThermostat,
    cover: mdiCog,
    scene: mdiPlayCircleOutline,
    calendar: mdiCalendar,
    notify: mdiBell,
};

export const entityDomain = (entityId: string) => entityId.split('.', 1)[0];
export const domainIcon = (entityId: string) => DOMAIN_ICONS[entityDomain(entityId)] ?? mdiShapeOutline;

export interface EntityRowProps {
    entityId: string;
    name?: string;
    /** Owning app. `orphan`: app no longer in config (shown in warn color). Omit to hide (e.g. inside an app's own page). */
    owner?: { id: string; orphan?: boolean; /** Link to the app page (caller builds it) */ href?: string };
    /** Current HA state; unlinked entities have none and show "unavailable". */
    state?: string;
    linked: boolean;
    autoClean?: boolean;
    persistState?: boolean;
    /** Link to the entity's detail page: makes the entity id a link */
    detailHref?: string;
    /** Link to the entity in HA (caller builds it - ingress/base URL aware). */
    href?: string;
    /** Stable row key, exposed as `data-row-key` so the palette can focus the row. */
    rowKey?: string;
    /** The row whose detail is open: highlighted */
    selected?: boolean;
    /** Trailing slot, e.g. "Delete from HA" on unlinked rows. */
    action?: ReactNode;
}

function OwnerName({ owner }: { owner: NonNullable<EntityRowProps['owner']> }) {
    const label = `${owner.id}${owner.orphan ? ' (orphan)' : ''}`;
    return owner.href
        ? <a className={`entity-owner${owner.orphan ? ' entity-owner-orphan' : ''}`} href={owner.href}>{label}</a>
        : <span className={owner.orphan ? 'entity-owner-orphan' : undefined}>{label}</span>;
}

/** Entity row (design.md "Entity row"). Single row on desktop, stacks at phone width. */
export function EntityRow(p: EntityRowProps) {
    const unavailable = p.state == null || !p.linked;
    return (
        <div data-row-key={p.rowKey} className={`entity-row${p.linked ? '' : ' entity-unlinked'}${p.selected ? ' entity-selected' : ''}`} aria-current={p.selected || undefined}>
            <span className="entity-icon"><Icon path={domainIcon(p.entityId)} size={16} /></span>
            <div className="entity-id">
                {p.detailHref
                    ? <a className="mono entity-eid entity-eid-link" href={p.detailHref} title={p.entityId}>{p.entityId}</a>
                    : <span className="mono entity-eid" title={p.entityId}>{p.entityId}</span>}
                {(p.name || p.owner) && (
                    <span className="entity-sub">
                        {p.name}
                        {p.name && p.owner ? ' · ' : null}
                        {p.owner && (
                            <OwnerName owner={p.owner} />
                        )}
                    </span>
                )}
            </div>
            <span className={`mono entity-state${unavailable ? ' entity-state-muted' : ''}`} title={unavailable ? undefined : p.state}>
                {unavailable ? 'unavailable' : p.state}
            </span>
            <span className="entity-flags">
                {p.autoClean && <Chip mono>auto_clean</Chip>}
                {p.persistState && <Chip mono>persist_state</Chip>}
            </span>
            <StateBadge kind="entity" state={p.linked ? 'linked' : 'unlinked'} />
            <span className="entity-actions">
                {p.href && (
                    <a className="icon-btn entity-ha-link" href={p.href} target="_blank" rel="noopener noreferrer" aria-label="Open in Home Assistant" title="Open in Home Assistant">
                        <Icon path={mdiOpenInNew} size={16} />
                    </a>
                )}
                {p.action}
            </span>
        </div>
    );
}
