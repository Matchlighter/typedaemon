import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react';
import { useRef, type ReactNode } from 'react';
import '../styles/virtuallist.css';

export interface VirtualListProps<T> {
    items: readonly T[];
    itemKey: (item: T) => string;
    /** Row height guess before it is measured (rows are measured, so wrapping rows are fine) */
    estimate: number;
    /** Gap between rows */
    gap?: number;
    render: (item: T) => ReactNode;
    /** Accessible name of the scroll area */
    label: string;
}

/** Scrolling list that keeps only the rows in view in the DOM (TanStack Virtual), so thousands of rows stay smooth. */
export const VirtualList = observer(function VirtualList<T>({ items, itemKey, estimate, gap = 0, render, label }: VirtualListProps<T>) {
    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => estimate,
        getItemKey: i => itemKey(items[i]),
        gap,
        overscan: 8,
    });
    return (
        <div ref={scroller} className="vlist" role="list" aria-label={label} tabIndex={0}>
            <div className="vlist-body" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map(v => (
                    <div key={v.key} role="listitem" data-index={v.index} ref={virtualizer.measureElement} className="vlist-row"
                        style={{ transform: `translateY(${v.start}px)` }}>
                        {render(items[v.index])}
                    </div>
                ))}
            </div>
        </div>
    );
}) as <T>(p: VirtualListProps<T>) => ReactNode;
