import { store, with_meta_components } from '@matchlighter/meta_components';
import type { ResumableRow, ScriptRow, ScriptRunRow } from '@protocol';
import { mdiClockOutline } from '@mdi/js';
import { observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import { app } from '../app';
import { ActionError } from '../components/ActionError';
import { Chip } from '../components/Chip';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ListStates } from '../components/ListStates';
import { RelativeTime } from '../components/RelativeTime';
import { ResumableCard } from '../components/ResumableCard';
import { ConfirmedAction } from '../stores/confirmed_action';
import { TopicStore } from '../stores/topic_store';
import '../styles/resumables.css';
import { cancelResumableCopy } from './resumable_copy';
import { groupResumables, limitLabel, runsLabel } from './resumables_model';

type Confirming =
    | { kind: 'cancel' | 'discard'; row: ResumableRow }
    | { kind: 'run'; script: string; run: ScriptRunRow };

const callOf = (r: ResumableRow) => `${r.owner}:${r.method}`;

/**
 * App detail "Resumables & Scripts" tab. Subscribed for as long as the tab is shown, so an app restart only
 * drops and recreates rows.
 */
@with_meta_components
@observer
export class AppResumablesTab extends Component<{ appId: string }> {
    @store resumables = new TopicStore(app.connection, 'appResumables', { id: this.props.appId });

    private action = new ConfirmedAction<Confirming>({
        call: c => c.kind === 'run'
            ? app.connection.call('script.cancel', { app: this.props.appId, script: c.script, run: c.run.id })
            : app.connection.call(c.kind === 'cancel' ? 'resumable.cancel' : 'resumable.discard', { app: this.props.appId, key: c.row.key }),
        failure: (c, message) => `Couldn't ${c.kind === 'run' ? `cancel the run of ${c.script}` : `${c.kind} ${callOf(c.row)}`}: ${message}`,
    });

    private confirmCopy(c: Confirming | undefined): { title: string; will: ReactNode; wont: ReactNode; label: string } {
        if (c?.kind === 'cancel') return cancelResumableCopy(callOf(c.row));
        if (c?.kind === 'discard') return {
            title: `Discard ${callOf(c.row)}?`, label: 'Discard',
            will: <>Forget this failed call. It is no longer saved, so it is not retried when the app starts.</>,
            wont: <>Run it, or undo anything it did before the app stopped.</>,
        };
        if (c?.kind === 'run') return {
            title: `Cancel run ${runsLabel(c.script, c.run.params)}?`, label: 'Cancel run',
            will: <>Stop this run of the script. Its code sees a cancellation at its next step.</>,
            wont: <>Stop other runs of the script or the script itself. Queued runs start as usual.</>,
        };
        return { title: '', will: null, wont: null, label: '' };
    }

    private rowAction(r: ResumableRow) {
        if (r.status === 'suspended') return undefined;
        const failed = r.status === 'failed';
        return (
            <button type="button" className="btn btn-sm btn-danger-outline" disabled={this.action.busy}
                onClick={() => this.action.request({ kind: failed ? 'discard' : 'cancel', row: r })}>
                {failed ? 'Discard…' : 'Cancel…'}
            </button>
        );
    }

    private scriptRow(s: ScriptRow) {
        const running = s.runs.filter(r => !r.queued);
        return (
            <tr key={s.key} data-script={s.key}>
                <td className="mono rsm-script">{s.key}</td>
                <td data-label="Mode"><Chip>{s.mode}</Chip></td>
                <td data-label="Running" className="mono">
                    {limitLabel(s)}
                    {s.limit != null && <span className="rsm-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, 100 * s.running / s.limit)}%` }} /></span>}
                </td>
                <td data-label="Queued" className="mono">{s.queued}</td>
                <td className="rsm-runs">
                    {running.length === 0 && <span className="rsm-idle">idle</span>}
                    {running.map(r => (
                        <div key={r.id} className="rsm-run">
                            <span className="mono rsm-run-call">{runsLabel(s.key, r.params)}</span>
                            <span className="rsm-run-age"><RelativeTime at={r.startedAt} /></span>
                            <button type="button" className="btn btn-sm btn-danger-outline" disabled={this.action.busy}
                                onClick={() => this.action.request({ kind: 'run', script: s.key, run: r })}>Cancel run…</button>
                        </div>
                    ))}
                </td>
            </tr>
        );
    }

    render() {
        const { data, error } = this.resumables;
        const groups = groupResumables(data?.resumables ?? []);
        const scripts = [...(data?.scripts ?? [])].sort((a, b) => a.key.localeCompare(b.key));
        const copy = this.confirmCopy(this.action.confirming);
        return (
            <section className="rsm">
                <ActionError error={this.action.error} />
                <ListStates
                    status={this.resumables.listStatus}
                    isEmpty={groups.length === 0}
                    card
                    empty={{ title: 'No resumables running', icon: mdiClockOutline, hint: 'Calls to @resumable methods and @script({shutdown:\'suspend\'}) runs show here while running, suspended, or failed to resume.' }}
                    error={{ title: "Couldn't load resumables", detail: error }}
                    syncingLabel="Syncing resumables…"
                >
                    {groups.map(g => (
                        <div key={g.status} className="rsm-group" data-group={g.status}>
                            <h3>{g.title} <span className="cnt">{g.rows.length}</span></h3>
                            <div className="rsm-list">
                                {g.rows.map(r => (
                                    <ResumableCard key={r.key} status={r.status} type={r.type} owner={r.owner} method={r.method} params={r.params}
                                        wait={r.wait} startedAt={r.startedAt} restarts={r.restarts} failure={r.failure} action={this.rowAction(r)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </ListStates>
                {data && (
                    <div className="rsm-group">
                        <h3>Scripts</h3>
                        <ListStates
                            status={this.resumables.listStatus}
                            isEmpty={scripts.length === 0}
                            card
                            empty={{ title: 'No scripts', hint: 'Methods decorated with @script show here with their mode, limit and current runs.' }}
                        >
                            <div className="tbl-wrap">
                                <table className="tbl tbl-stack rsm-table">
                                    <thead><tr><th>Script</th><th>Mode</th><th>Running</th><th>Queued</th><th>Current run</th></tr></thead>
                                    <tbody>{scripts.map(s => this.scriptRow(s))}</tbody>
                                </table>
                            </div>
                        </ListStates>
                    </div>
                )}
                <ConfirmDialog
                    open={!!this.action.confirming}
                    title={copy.title}
                    will={copy.will}
                    wont={copy.wont}
                    confirmLabel={copy.label}
                    onConfirm={() => void this.action.confirm()}
                    onCancel={() => this.action.cancel()}
                />
            </section>
        );
    }
}
