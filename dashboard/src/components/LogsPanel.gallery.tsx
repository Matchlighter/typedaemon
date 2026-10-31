import type { LogRow } from '@protocol';
import type { GallerySection } from '../gallery';
import { LogsViewState } from '../views/logs_view_state';
import { LogsPanel } from './LogsPanel';

const rows: LogRow[] = Array.from({ length: 2000 }, (_, i) => ({
    id: i + 1, ts: Date.now() - (2000 - i) * 1000, source: { kind: 'app', id: 'lights' }, channel: i % 7 === 0 ? 'manager' : 'user',
    level: i % 97 === 0 ? 'error' : i % 31 === 0 ? 'warn' : i % 7 === 0 ? 'lifecycle' : i % 3 === 0 ? 'debug' : 'info',
    message: i % 97 === 0 ? 'Scene transition failed' : `Light ${i} updated`,
    ...(i % 97 === 0 && { stack: [{ fn: 'Lights.run', file: 'apps/lights/index.ts', line: 42, col: 17 }] }),
}));

export default {
    title: 'Logs panel (2000 lines, virtualized)',
    render: () => (
        <>
            <LogsPanel rows={rows} state={new LogsViewState()} status="live" title="Logs" />
            <LogsPanel rows={[]} state={new LogsViewState()} status="live" emptyHint="Lines appear here as the app logs." />
            <LogsPanel rows={[]} state={new LogsViewState()} status="error" error="Unknown app: lights" />
        </>
    ),
} satisfies GallerySection;
