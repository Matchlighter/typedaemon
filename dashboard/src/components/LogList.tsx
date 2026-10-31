import type { LogRow } from '@protocol';
import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { causeIdAt, toLogEntry } from '../views/logs_model';
import '../styles/loglist.css';
import { LogLine } from './LogLine';

export interface LogListProps {
    /** Oldest first */
    rows: readonly LogRow[];
    /** Stay at the newest line as lines arrive */
    follow: boolean;
    /** Scroll to this line and mark it */
    focusId?: number;
    /** Stack open/closed, kept by the owner by line id: rows unmount as they scroll out of view */
    isExpanded: (id: number) => boolean;
    onToggle: (id: number, open: boolean) => void;
    /** The user scrolled up while `follow` was on */
    onScrollAway?: () => void;
    /** "jump to cause" on a line: scroll to the line with this id */
    onJumpToCause?: (id: number) => void;
    /** Leave out the source column (the list is one source's) */
    hideSource?: boolean;
    /** Row after the last line, inside the frame (eg the tail indicator) */
    footer?: ReactNode;
}

/** How far from the end still counts as "at the tail" */
const TAIL_SLACK_PX = 80;
const COLLAPSED_ROW_PX = 25;

/**
 * Virtualized list of log lines (TanStack Virtual): only the lines in view are in the DOM, so 10k+ lines
 * stay smooth. Collapsed lines are one fixed height; open stacks are measured.
 */
export const LogList = observer(function LogList({ rows, follow, focusId, isExpanded, onToggle, onScrollAway, onJumpToCause, hideSource, footer }: LogListProps) {
    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => COLLAPSED_ROW_PX,
        getItemKey: i => rows[i].id,
        overscan: 12,
    });

    useLayoutEffect(() => {
        if (follow && rows.length) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }, [follow, rows.length, virtualizer]);

    useEffect(() => {
        if (focusId === undefined) return;
        const i = rows.findIndex(r => r.id === focusId);
        if (i < 0) return;
        virtualizer.scrollToIndex(i, { align: 'center' });
        // The virtualizer only scrolls the list. Once the row is mounted, centre it in the page too.
        let tries = 0, raf = 0;
        const reveal = () => {
            const el = scroller.current?.querySelector<HTMLElement>('.log-focus');
            if (el) el.scrollIntoView({ block: 'center' });
            else if (tries++ < 20) raf = requestAnimationFrame(reveal);
        };
        raf = requestAnimationFrame(reveal);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusId, virtualizer]);

    // Following only ever moves down. Moving up and away from the end is the user.
    const lastTop = useRef(0);
    const onScroll = () => {
        const el = scroller.current;
        if (!el) return;
        const movedUp = el.scrollTop < lastTop.current;
        lastTop.current = el.scrollTop;
        if (follow && movedUp && el.scrollHeight - el.scrollTop - el.clientHeight > TAIL_SLACK_PX) onScrollAway?.();
    };

    return (
        <div className="loglist-frame">
            <div className={`log-line log-head${hideSource ? ' log-nosrc' : ''}`} aria-hidden="true"><span>Time</span><span>Level</span>{!hideSource && <span className="log-src">Source</span>}<span>Message</span></div>
            <div ref={scroller} className="loglist" role="log" aria-live="off" aria-label="Log lines" tabIndex={0} onScroll={onScroll}>
                <div className="loglist-body" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(v => {
                        const row = rows[v.index];
                        return (
                            <div key={v.key} data-index={v.index} ref={virtualizer.measureElement}
                                className={`loglist-row${row.id === focusId ? ' log-focus' : ''}`} style={{ transform: `translateY(${v.start}px)` }}>
                                <LogLine entry={toLogEntry(row, causeIdAt(rows, v.index))} expanded={isExpanded(row.id)} hideSource={hideSource} onToggle={open => onToggle(row.id, open)} onJumpToCause={onJumpToCause} />
                            </div>
                        );
                    })}
                </div>
            </div>
            {footer}
        </div>
    );
});
