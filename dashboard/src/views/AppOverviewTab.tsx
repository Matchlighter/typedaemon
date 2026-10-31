import type { AppDetail } from '@protocol';
import { Chip } from '../components/Chip';
import { RelativeTime } from '../components/RelativeTime';
import { SummaryCard } from '../components/SummaryCard';
import { dash, formatBytes } from '../format';
import { appHref } from '../hrefs';
import { isSettling } from './app_detail_model';
import { RecentLogs } from './RecentLogs';

function Details({ detail }: { detail: AppDetail }) {
    const packages = Object.entries(detail.packages);
    const deps = detail.summary?.dependsOn ?? [];
    return (
        <section className="card appd-details" data-card="details">
            <h2>Details</h2>
            <dl className="appd-kv">
                <dt>UUID</dt><dd className="mono">{detail.uuid}</dd>
                <dt>Instance of</dt><dd className="mono">{detail.instanceOf}</dd>
                <dt>Log level</dt><dd>{detail.logLevel ?? '—'}</dd>
                <dt>Depends on</dt>
                <dd className="appd-deps">{deps.length ? deps.map(id => <Chip key={id} tone="ok">{id}</Chip>) : '—'}</dd>
                <dt>Packages</dt>
                <dd>{packages.length ? packages.map(([name, version]) => <span key={name} className="mono appd-pkg">{name} {version}</span>) : '—'}</dd>
            </dl>
        </section>
    );
}

/** App detail "Overview" tab: summary cards per subsystem, recent logs, details. */
export function AppOverviewTab({ detail }: { detail: AppDetail }) {
    const id = detail.row.id;
    const { counts } = detail;
    const settling = isSettling(detail.row.state);
    const val = (n: number | undefined) => settling ? '…' : dash(n);
    const unlinked = settling ? undefined : counts.unlinkedEntities;
    const { nextSchedule, storage, scripts } = detail.summary ?? {};
    return (
        <>
            <div className="appd-sums">
                <SummaryCard id="entities" label="Entities" href={appHref(id, 'entities')} value={val(counts.entities)}
                    warn={unlinked ? `${unlinked} unlinked` : undefined} />
                <SummaryCard id="schedules" label="Schedules" href={appHref(id, 'schedules')} value={val(counts.schedules)}
                    note={nextSchedule && <>next <span className="mono">{nextSchedule.expression}</span> <RelativeTime at={nextSchedule.at} /></>} />
                <SummaryCard id="storage" label="Storage" href={appHref(id, 'storage')} value={val(counts.storage)}
                    unit={storage ? `keys · ${formatBytes(storage.bytes)}` : 'keys'}
                    note={storage && <>+{storage.internal} internal{storage.lastWriteAt !== undefined && <> · last write <RelativeTime at={storage.lastWriteAt} /></>}</>} />
                <SummaryCard id="scripts" label="Scripts" href={appHref(id, 'resumables')} value={val(counts.scripts)} unit="running"
                    note={scripts && `${scripts.running.join(', ') || 'none running'} · ${scripts.queued} queued`} />
            </div>
            <div className="appd-split">
                <section className="card appd-logs" data-card="logs">
                    <div className="appd-logs-head">
                        <h2>Recent logs</h2>
                        <a className="btn btn-sm" href={appHref(id, 'logs')}>Open logs</a>
                    </div>
                    <RecentLogs appId={id} />
                </section>
                <Details detail={detail} />
            </div>
        </>
    );
}
