import { LogsView } from './LogsView';

/** `#/logs`: every source (system, plugins, apps) merged in time order, with a source filter. */
export function Logs() {
    return <LogsView viewKey="global" title="Logs" sourceFilter emptyHint="Lines appear here as TypeDaemon, plugins and apps log." />;
}
