import { mdiOpenInNew } from '@mdi/js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';
import '../styles/entity.css';
import { Chip } from './Chip';
import { domainIcon } from './EntityRow';
import { Icon } from './Icon';
import { StateBadge } from './StateBadge';

export interface EntityTableRow {
    key: string;
    entityId: string;
    name?: string;
    domain: string;
    /** Current HA state; unlinked entities have none and show "unavailable". */
    state?: string;
    linked: boolean;
    autoClean?: boolean;
    persistState?: boolean;
    /** Link to the entity's detail page: makes the entity id a link */
    detailHref?: string;
    /** Link to the entity in HA (see `haEntityHref`). Omitted when the dashboard can't tell where HA is. */
    ha?: { href: string; target: '_top' | '_blank' };
    /** Owning app (global list). `orphan`: app no longer in config (shown in warn color). */
    owner?: { id: string; orphan?: boolean; /** Link to the app page (caller builds it) */ href?: string };
    /** Owning plugin's link is down: state is last-known (dimmed like a stale list) */
    stale?: boolean;
    /** The row whose detail is open: highlighted */
    selected?: boolean;
    /** Trailing slot, e.g. "Delete from HA" on unlinked rows. */
    action?: ReactNode;
}

export interface EntityTableColumns {
    /** Owning app column (global list) */
    owner?: boolean;
    domain?: boolean;
    flags?: boolean;
}

const ROW_PX = 56;

function OwnerName({ owner }: { owner: NonNullable<EntityTableRow['owner']> }) {
    const cls = `mono entity-owner${owner.orphan ? ' entity-owner-orphan' : ''}`;
    const label = `${owner.id}${owner.orphan ? ' (orphan)' : ''}`;
    return owner.href ? <a className={cls} href={owner.href}>{label}</a> : <span className={cls}>{label}</span>;
}

function EntityTableRowView({ r, cols, index, measure }: { r: EntityTableRow; cols: Required<EntityTableColumns>; index?: number; measure?: (el: HTMLTableRowElement | null) => void }) {
    const unavailable = r.state == null || !r.linked;
    return (
        <tr ref={measure} data-index={index} data-row-key={r.key} className={`entity-row${r.linked ? '' : ' entity-unlinked'}${r.selected ? ' entity-selected' : ''}${r.stale ? ' entity-stale' : ''}`} aria-current={r.selected || undefined}>
            <td>
                <span className="enttbl-ident">
                    <span className="entity-icon"><Icon path={domainIcon(r.entityId)} size={16} /></span>
                    <span className="entity-id">
                        {r.detailHref
                            ? <a className="mono entity-eid entity-eid-link" href={r.detailHref} title={r.entityId}>{r.entityId}</a>
                            : <span className="mono entity-eid" title={r.entityId}>{r.entityId}</span>}
                        {r.name && <span className="entity-sub">{r.name}</span>}
                    </span>
                </span>
            </td>
            {cols.owner && <td>{r.owner && <OwnerName owner={r.owner} />}</td>}
            {cols.domain && <td><Chip>{r.domain}</Chip></td>}
            <td className={`mono entity-state${unavailable ? ' entity-state-muted' : ''}`} title={unavailable ? undefined : r.state}>
                {unavailable ? 'unavailable' : r.state}
            </td>
            {cols.flags && (
                <td>
                    <span className="entity-flags">
                        {r.autoClean && <Chip>auto_clean</Chip>}
                        {r.persistState && <Chip>persist_state</Chip>}
                    </span>
                </td>
            )}
            <td><StateBadge kind="entity" state={r.linked ? 'linked' : 'unlinked'} /></td>
            <td className="enttbl-actions">
                {r.action}
                {r.ha && (
                    <a className="icon-btn entity-ha-link" {...r.ha} rel="noopener noreferrer" aria-label={`Open ${r.entityId} in Home Assistant`} title="Open in Home Assistant">
                        <Icon path={mdiOpenInNew} size={16} />
                    </a>
                )}
            </td>
        </tr>
    );
}

/**
 * Entity table (design mock "App detail > Entities", "Entities"): id + name, [owner], [domain], state, [flags], link status, actions.
 * `virtual`: scrolls in a fixed-height box and keeps only the rows in view in the DOM (for the global list; thousands of rows).
 */
export function EntityTable({ rows, label = 'Entities', columns, virtual }: { rows: EntityTableRow[]; label?: string; columns?: EntityTableColumns; virtual?: boolean }) {
    const cols = { owner: false, domain: true, flags: true, ...columns };
    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: virtual ? rows.length : 0,
        getScrollElement: () => scroller.current,
        estimateSize: () => ROW_PX,
        getItemKey: i => rows[i].key,
        overscan: 8,
    });
    const items = virtual ? virtualizer.getVirtualItems() : [];
    const colCount = 3 + +cols.owner + +cols.domain + +cols.flags;
    const padTop = items.length ? items[0].start : 0;
    const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
    return (
        <div ref={scroller} className={`tbl-wrap enttbl-wrap${virtual ? ' enttbl-virtual' : ''}`} tabIndex={virtual ? 0 : undefined} aria-label={virtual ? label : undefined}>
            <table className={`tbl enttbl${cols.domain ? '' : ' enttbl-narrow'}`} aria-label={label}>
                <thead>
                    <tr>
                        <th>Entity</th>{cols.owner && <th>Owner</th>}{cols.domain && <th>Domain</th>}<th>State</th>{cols.flags && <th>Flags</th>}<th>Link</th><th className="enttbl-actions" />
                    </tr>
                </thead>
                <tbody>
                    {virtual ? <>
                        {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={colCount} style={{ padding: 0, border: 0 }} /></tr>}
                        {items.map(v => <EntityTableRowView key={v.key} r={rows[v.index]} cols={cols} index={v.index} measure={virtualizer.measureElement} />)}
                        {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={colCount} style={{ padding: 0, border: 0 }} /></tr>}
                    </> : rows.map(r => <EntityTableRowView key={r.key} r={r} cols={cols} />)}
                </tbody>
            </table>
        </div>
    );
}
