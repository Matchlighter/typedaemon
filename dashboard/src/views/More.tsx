import { observer } from 'mobx-react';
import { app } from '../app';
import { RouteStore } from '../stores/route_store';
import { navRoutes } from '../routes';

/** Phone-only overflow for nav items that don't fit the bottom bar. */
export const More = observer(function More() {
    return (
        <>
            <div className="page-title"><h1>More</h1></div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {navRoutes.filter(r => !r.phone).map(r => <a key={r.key} href={RouteStore.href('/' + r.key)}>{r.label}</a>)}
                <button type="button" className="btn btn-sm" onClick={app.theme.toggle}>Switch to {app.theme.theme === 'dark' ? 'light' : 'dark'} theme</button>
            </div>
        </>
    );
});
