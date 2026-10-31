import { store, with_meta_components } from '@matchlighter/meta_components';
import type { GlobalResumableRow, OrphanRow, SystemSnapshot } from '@protocol';
import { observer } from 'mobx-react';
import { mdiChevronRight } from '@mdi/js';
import { Component, type ReactNode } from 'react';
import { app } from '../app';
import { ProportionBar, type BarSegment } from '../components/ProportionBar';
import { ActionError } from '../components/ActionError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { ListStates } from '../components/ListStates';
import { absoluteTime, RelativeTime } from '../components/RelativeTime';
import { badgeSpec, StateBadge } from '../components/StateBadge';
import { StatusDot } from '../components/StatusDot';
import { formatDuration, plural } from '../format';
import { appHref, errorLogsHref, pluginHref } from '../hrefs';
import { ConfirmedAction } from '../stores/confirmed_action';
import { Flash } from '../stores/flash';
import { RouteStore } from '../stores/route_store';
import { combinedListStatus, TopicStore } from '../stores/topic_store';
import '../styles/overview.css';
import { attentionItems, entitySummary, feedEntries, healthSummary, upNext, type EntitySummary, type FeedEntry } from './overview_model';
import { cancelResumableCopy } from './resumable_copy';
import { pluginBadge, sortPlugins } from './plugins_model';

interface CardProps {
    name: string;
    label: string;
    href: string;
    /** `warn` accents the card (amber top edge and number): something to clean up */
    tone?: 'warn';
    value: ReactNode;
    /** Proportion bar under the number */
    bar?: BarSegment[];
    note: ReactNode;
}
function HealthCard({ name, label, href, tone, value, bar, note }: CardProps) {
    return (
        <a className={`card ov-card${tone ? ` ov-${tone}` : ''}`} href={href} data-card={name}>
            <span className="lbl">{label}</span>
            <span className="ov-value">{value}</span>
            {bar && <ProportionBar segments={bar} />}
            <span className="ov-note">{note}</span>
        </a>
    );
}

/** "2 started · 1 dead": the non-zero parts, in order */
const breakdown = (parts: [number, string][]) => parts.filter(([n]) => n > 0).map(([n, l]) => `${n} ${l}`).join(' · ');

/** "old_presence · 3 entities left in HA" */
function orphanNote(orphans: OrphanRow[], entities: EntitySummary): string {
    const left = orphans.reduce((n, o) => n + (entities.leftBehind[o.id] ?? 0), 0);
    return [orphans.map(o => o.id).join(', '), left ? `${plural(left, 'entity', 'entities')} left in HA` : ''].filter(Boolean).join(' · ');
}

/** Running badge, uptime, timezone and config file under the page title */
function StatusStrip({ sys }: { sys: SystemSnapshot }) {
    const running = sys.state === 'running';
    return (
        <div className="ov-status muted">
            <StateBadge kind="app" state={running ? 'started' : 'stopping'} label={running ? 'running' : 'shutting down'} />
            <span>Hypervisor up <span title={`Started ${absoluteTime(sys.startedAt, sys.now)}`}>{formatDuration(sys.now - sys.startedAt)}</span></span>
            {sys.location?.timezone && <><span aria-hidden="true">·</span><span>{sys.location.timezone}</span></>}
            {sys.configPath && <><span aria-hidden="true">·</span><span className="mono">{sys.configPath}</span></>}
        </div>
    );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const clockTime = (ts: number) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };

/** One feed line: time, state dot, app + "from → to", reason, relative time. A new event flashes it. */
@with_meta_components
@observer
class FeedRow extends Component<{ entry: FeedEntry }> {
    @store flash = new Flash(() => this.props.entry.event.id);

    componentDidUpdate() { this.flash.check(); }

    render() {
        const { event, transition, tone, reason } = this.props.entry;
        return (
            <li className={this.flash.active ? 'ov-row ov-event flash' : 'ov-row ov-event'} data-event={event.id}>
                <time className="mono muted ov-event-time" dateTime={new Date(event.ts).toISOString()} title={absoluteTime(event.ts, Date.now())}>{clockTime(event.ts)}</time>
                <StatusDot tone={badgeSpec(tone).tone} />
                <span className="ov-event-main">
                    <span><a href={appHref(event.app)}>{event.name}</a> <span className="mono ov-event-trans">{transition}</span></span>
                    {reason && <span className="muted ov-event-why">{reason}</span>}
                    {event.error && (event.errorLogId !== undefined
                        ? <a className="ov-event-error" href={errorLogsHref(event.app, event.errorLogId)} title="Show the log line that reported this">{event.error}</a>
                        : <span className="ov-event-error">{event.error}</span>)}
                </span>
                <span className="muted ov-event-rel"><RelativeTime at={event.ts} /></span>
            </li>
        );
    }
}

/** Card with a title row (and optional action link) over a list of full-bleed rows */
function Panel({ name, title, action, children }: { name: string; title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="card ov-panel" aria-label={title} data-panel={name}>
            <div className="ov-panel-head"><h2>{title}</h2>{action}</div>
            {children}
        </section>
    );
}

/** `#/overview`: is everything OK? Health cards, what needs attention (each item links to its fix), recent restarts. */
@with_meta_components
@observer
export class Overview extends Component {
    @store apps = new TopicStore(app.connection, 'apps');
    @store plugins = new TopicStore(app.connection, 'plugins');
    @store feed = new TopicStore(app.connection, 'lifecycle');
    @store entitiesTopic = new TopicStore(app.connection, 'entities');
    @store schedules = new TopicStore(app.connection, 'schedules');
    @store resumables = new TopicStore(app.connection, 'resumables');

    private cancel = new ConfirmedAction<GlobalResumableRow>({
        call: r => app.connection.call('resumable.cancel', { app: r.app, key: r.resumableKey }),
        failure: (r, message) => `Couldn't cancel ${r.owner}:${r.method}: ${message}`,
    });

    render() {
        const apps = this.apps.data, plugins = this.plugins.data, sys = app.system.data;
        const ready = apps && plugins && sys && this.entitiesTopic.data;
        const input = ready && { apps: apps.apps, orphans: apps.orphans, plugins: plugins.plugins, calls: sys.crossCalls };
        const health = input && healthSummary(input);
        const entities = entitySummary(this.entitiesTopic.data?.rows ?? []);
        const attention = input ? attentionItems(input) : [];
        const events = feedEntries(this.feed.data?.events ?? []);
        const next = upNext(this.schedules.data?.rows ?? []);
        const running = (this.resumables.data?.rows ?? []).filter(r => r.status === 'running');
        const cancelling = this.cancel.confirming;
        const copy = cancelResumableCopy(cancelling ? `${cancelling.owner}:${cancelling.method}` : '');

        return (
            <>
                <div className="page-title ov-title"><h1>Overview</h1>{sys && <StatusStrip sys={sys} />}</div>
                <ListStates
                    status={combinedListStatus(app.system, this.apps, this.plugins, this.entitiesTopic)}
                    error={{ title: "Couldn't load the overview", detail: this.apps.error ?? this.plugins.error }}
                    syncingLabel="Syncing overview…"
                >
                    {health && apps && (
                        <div className="ov">
                            <section className="ov-cards" aria-label="Health summary">
                                <HealthCard name="apps" label="Apps" href={RouteStore.href('/apps')} value={health.apps.total}
                                    bar={[{ count: health.apps.started, tone: 'ok' }, { count: health.apps.starting, tone: 'run' }, { count: health.apps.dead, tone: 'err' }, { count: health.apps.stopped, tone: 'off' }]}
                                    note={breakdown([[health.apps.started, 'started'], [health.apps.starting, 'starting'], [health.apps.dead, 'dead'], [health.apps.stopped, 'stopped']]) || 'No apps'} />
                                <HealthCard name="plugins" label="Plugins" href={RouteStore.href('/plugins')}
                                    value={<>{health.plugins.ok}<span className="muted">/{health.plugins.total}</span></>}
                                    bar={[{ count: health.plugins.ok, tone: 'ok' }, { count: health.plugins.total - health.plugins.ok, tone: 'err' }]}
                                    note={health.plugins.ok === health.plugins.total ? 'All connected' : `${health.plugins.total - health.plugins.ok} not connected`} />
                                <HealthCard name="orphans" label="Orphans" href={RouteStore.href('/apps')} tone={health.orphans ? 'warn' : undefined} value={health.orphans}
                                    note={health.orphans ? orphanNote(apps.orphans, entities) : 'Nothing to clean up'} />
                                <HealthCard name="resumables" label="Resumables" href={RouteStore.href('/apps')} value={health.resumables}
                                    note={`${health.resumables - health.failedResumes} waiting · ${health.failedResumes} failed to resume`} />
                                <HealthCard name="entities" label="Entities" href={RouteStore.href('/entities')} value={entities.total}
                                    note={`${entities.linked} linked · ${entities.unlinked} unlinked`} />
                            </section>

                            <section className="card ov-attention" aria-label="Needs attention">
                                <h2>Needs attention {attention.length > 0 && <span className="cnt cnt-w">{attention.length}</span>}</h2>
                                {attention.length === 0 ? <p className="note" role="status">Everything is running.</p> : (
                                    <ul className="ov-list">
                                        {attention.map(i => (
                                            <li key={i.key} data-attention={i.key} data-severity={i.severity} className={`ov-item ov-item-${i.severity}`}>
                                                <StateBadge {...i.badge} />
                                                <span className="ov-item-main">
                                                    <span className="ov-item-line">
                                                        <a href={i.href}>{i.subject}</a><span className="ov-item-what"> {i.text}{i.at !== undefined && <> <RelativeTime at={i.at} /></>}</span>
                                                    </span>
                                                    {i.detail && <span className={`ov-detail ov-detail-${i.detailTone ?? 'muted'}`}>{i.detail}</span>}
                                                </span>
                                                <a className="btn btn-sm ov-item-action" href={i.href}>{i.action}</a>
                                                <Icon path={mdiChevronRight} size={20} className="ov-chevron" />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <section className="card ov-panel ov-phone" aria-label="Apps" data-panel="phone-apps">
                                <div className="ov-panel-head"><h2 className="lbl">Apps</h2></div>
                                <ul className="ov-list">
                                    {apps.apps.map(a => (
                                        <li key={a.id}>
                                            <a className="ov-row ov-app" href={appHref(a.id)} data-app={a.id}>
                                                <StateBadge kind="app" state={a.state} />
                                                <span className="ov-app-name">{a.name}</span>
                                                <span className="muted ov-app-age"><RelativeTime at={a.since} mode="age" /></span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            {running.length > 0 && (
                                <section className="card ov-panel ov-phone" aria-label="Running resumables" data-panel="phone-resumables">
                                    <div className="ov-panel-head"><h2 className="lbl">Running resumables · {running.length}</h2></div>
                                    <ActionError error={this.cancel.error} />
                                    <ul className="ov-list">
                                        {running.map(r => (
                                            <li key={r.key} className="ov-row ov-resumable" data-resumable={r.key}>
                                                <span className="ov-next-main">
                                                    <span className="mono ov-resumable-call">{r.owner}:{r.method}</span>
                                                    <span className="muted ov-next-what">
                                                        {r.wait?.kind === 'sleep' && <>sleeping until {clockTime(r.wait.until)} · </>}
                                                        {r.wait?.kind === 'condition' && <>waiting for {r.wait.condition} · </>}
                                                        started <RelativeTime at={r.startedAt} />
                                                    </span>
                                                </span>
                                                <button type="button" className="btn btn-sm btn-danger-outline" disabled={this.cancel.busy} onClick={() => this.cancel.request(r)}>Cancel</button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            <div className="ov-cols">
                                <Panel name="feed" title="Lifecycle events" action={<a className="ov-panel-link" href={RouteStore.href('/logs')}>All logs</a>}>
                                    {events.length === 0
                                        ? <p className="note ov-panel-note">No app has started, restarted or died since TypeDaemon started.</p>
                                        : <ul className="ov-list">{events.map(e => <FeedRow key={e.event.id} entry={e} />)}</ul>}
                                </Panel>
                                <div className="ov-side">
                                    <Panel name="plugins" title="Plugins">
                                        <ul className="ov-list">
                                            {sortPlugins(plugins.plugins).map(p => (
                                                <li key={p.id} className="ov-row ov-plugin" data-plugin={p.id}>
                                                    <StatusDot tone={badgeSpec(pluginBadge(p)).tone} />
                                                    <a className="mono ov-plugin-id" href={pluginHref(p.id)}>{p.id}</a>
                                                    {p.target && <span className="mono muted ov-plugin-target" title={p.target}>{p.target}</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    </Panel>
                                    <Panel name="next" title="Up next">
                                        {next.length === 0
                                            ? <p className="note ov-panel-note">Nothing scheduled.</p>
                                            : <ul className="ov-list">
                                                {next.map(r => (
                                                    <li key={r.key} className="ov-row ov-next" data-schedule={r.key}>
                                                        <span className="ov-next-main">
                                                            <span className="mono ov-next-expr">{r.expression}</span>
                                                            <span className="muted ov-next-what"><a href={appHref(r.app, 'schedules')}>{r.app}</a> · {r.method}</span>
                                                        </span>
                                                        <RelativeTime at={r.nextAt!} />
                                                    </li>
                                                ))}
                                            </ul>}
                                    </Panel>
                                </div>
                            </div>
                        </div>
                    )}
                </ListStates>
                <ConfirmDialog open={!!cancelling} title={copy.title} will={copy.will} wont={copy.wont} confirmLabel={copy.label}
                    onConfirm={() => void this.cancel.confirm()} onCancel={() => this.cancel.cancel()} />
            </>
        );
    }
}
