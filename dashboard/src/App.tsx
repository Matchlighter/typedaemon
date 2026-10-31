import { mdiChevronLeft } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component } from 'react';
import { app } from './app';
import { AppPalette } from './components/AppPalette';
import { ConnectionBanner, ConnectionPill, ConnectionSyncing } from './components/ConnectionStatus';
import { SearchTrigger } from './components/SearchTrigger';
import { Icon } from './components/Icon';
import { MORE_ICON, navRoutes, routes } from './routes';
import { RouteStore } from './stores/route_store';

@observer
export class App extends Component {
    render() {
        const { route, theme, connection } = app;
        const chrome = app.chrome.current;
        const badges = app.navCounts.badges;
        const current = routes.find(r => r.key === route.section) ?? routes[0];
        return (
            <div className="shell">
                <header className="top">
                    <div className="logo" aria-hidden>T›</div>
                    <span className="brand">TypeDaemon</span>
                    {chrome?.backHref && <a className="page-back" href={chrome.backHref} aria-label="Back"><Icon path={mdiChevronLeft} size={24} /></a>}
                    <span className="page-name">{chrome?.title ?? current.label}</span>
                    <span className="ver">{app.system.data?.version}</span>
                    <span className="spacer" />
                    <SearchTrigger />
                    <ConnectionSyncing connection={connection} label="Syncing…" />
                    <ConnectionPill connection={connection} />
                    <button className="icon-btn theme-toggle" aria-label={`Switch to ${theme.theme === 'dark' ? 'light' : 'dark'} theme`} onClick={theme.toggle}>
                        {theme.theme === 'dark' ? '☀' : '☾'}
                    </button>
                </header>
                <ConnectionBanner connection={connection} />
                <nav className="nav" aria-label="Sections">
                    {navRoutes.map(r => (
                        <a key={r.key} href={RouteStore.href('/' + r.key)}
                            className={r.phone ? undefined : 'desktop-only'}
                            aria-current={current.key === r.key ? 'page' : undefined}>
                            {r.icon && <Icon path={r.icon} size={22} className="nav-icon" />}
                            {r.label}
                            {badges[r.key]?.count !== undefined && <span className="cnt">{badges[r.key].count}</span>}
                            {!!badges[r.key]?.errors && <span className="cnt cnt-e" aria-label={`${badges[r.key].errors} dead`}>{badges[r.key].errors}</span>}
                        </a>
                    ))}
                    <a className="phone-only" href={RouteStore.href('/more')} aria-current={current.key === 'more' ? 'page' : undefined}><Icon path={MORE_ICON} size={22} className="nav-icon" />More</a>
                </nav>
                <main className="main">{current.render(route)}</main>
                <AppPalette />
            </div>
        );
    }
}
