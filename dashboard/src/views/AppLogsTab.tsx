import { LogsView } from './LogsView';

/**
 * App detail "Logs" tab: the app's history, then its live tail. `?focus=<log id>` (from the startup error panel,
 * lifecycle feed) opens on that line; `?focus=error` on the newest error.
 */
export function AppLogsTab({ appId }: { appId: string }) {
    return <LogsView viewKey={`app:${appId}`} sources={[{ kind: 'app', id: appId }]} scoped routeFocus emptyHint="Lines appear here as the app logs." />;
}
