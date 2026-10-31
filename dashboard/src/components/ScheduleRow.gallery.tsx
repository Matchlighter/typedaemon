import type { GallerySection } from '../gallery';
import '../styles/schedule.css';
import { ScheduleHead, ScheduleRow, type ScheduleRowProps } from './ScheduleRow';

const MIN = 60_000, H = 60 * MIN;
const now = Date.now();

const rows: ScheduleRowProps[] = [
    { expression: 'sunset-0:30', kind: 'sun', method: 'evening_scene', nextAt: now + 3 * H + 53 * MIN, lastAt: now - 20 * H, lastResult: 'ok', lastDurationMs: 1200 },
    { expression: '*/15 * * * *', kind: 'cron', method: 'sync_presence', nextAt: now + 7 * MIN + 48_000, lastAt: now - 7 * MIN, lastResult: 'ok', lastDurationMs: 92 },
    { expression: 'sunrise+0:15', kind: 'sun', method: 'morning_off', nextAt: now + 16 * H + 26 * MIN, lastAt: now - 8 * H, lastResult: 'error' },
    { expression: 'MON-FRI 6:45 AM', kind: 'cron', method: 'wake_up', nextAt: now + 14 * H, lastAt: now - 10 * H, lastResult: 'ok' },
    { expression: "run_every('5m')", kind: 'interval', method: 'poll_sensors', nextAt: now + 2 * MIN, lastAt: now - 3 * MIN, lastResult: 'ok' },
    { expression: '2026-12-24 18:00', kind: 'at', method: 'a_rather_long_callback_method_name_that_must_ellipsise', nextAt: now + 66 * 24 * H },
];

export default {
    title: 'Schedule row',
    render: () => (
        <div className="sched-list">
            <ScheduleHead />
            {rows.map(r => <ScheduleRow key={r.expression} {...r} />)}
        </div>
    ),
} satisfies GallerySection;
