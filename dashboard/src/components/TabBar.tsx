export interface TabBarItem<K extends string = string> {
    key: K;
    label: string;
    /** Number (or placeholder text such as `…`) shown beside the label; 0/undefined hides it */
    count?: number | string;
    /** Warning text beside the count (e.g. `+1 unlinked`) */
    flag?: string;
}

/** The tab for a route segment; unknown/missing -> the first tab */
export const visibleTab = <K extends string>(tabs: readonly { key: K }[], segment: string | undefined): K =>
    tabs.find(t => t.key === segment)?.key ?? tabs[0].key;

/** Tab bar of a detail page: one link per tab (`hrefFor`), the current one marked. The route owns which tab is current. */
export function TabBar<K extends string>({ label, tabs, current, hrefFor }: { label: string; tabs: readonly TabBarItem<K>[]; current: K; hrefFor: (key: K) => string }) {
    return (
        <nav className="appd-tabs" aria-label={label}>
            {tabs.map(t => (
                <a key={t.key} data-tab={t.key} href={hrefFor(t.key)} aria-current={current === t.key ? 'page' : undefined}>
                    {t.label}
                    {!!t.count && <span className="cnt">{t.count}</span>}
                    {t.flag && <span className="cnt cnt-w">{t.flag}</span>}
                </a>
            ))}
        </nav>
    );
}
