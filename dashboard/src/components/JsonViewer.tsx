import { observer } from 'mobx-react';
import { Component } from 'react';
import { mdiChevronDown, mdiChevronRight, mdiContentCopy } from '@mdi/js';
import { scopedPath, sharedJsonViewState, type JsonViewState, type Loader } from '../stores/json_view_state';
import '../styles/json.css';
import { copyText } from './clipboard';
import { Icon } from './Icon';
import { formatBytes } from '../format';
import { childPath, describeValue, isLazy, truncateString } from './json_model';
import { with_meta_components } from '@matchlighter/meta_components';

export interface JsonViewerProps {
    value: unknown;
    /** Fetches the real value for a `lazy()` placeholder at `path`. */
    loader?: Loader;
    /** Open/loaded state; defaults to the shared, persisted one. Open state is keyed by JSON path. */
    state?: JsonViewState;
    /** Name of this viewer within a shared `state` (see `scopedPath`); needed when several viewers share one. Loaders receive scoped paths. */
    scope?: string;
    /** Trailing `// text` comments by JSON path (`$.a.b`, as `childPath` builds; not scoped) */
    annotations?: Record<string, string>;
    /** Show the viewer's own copy button (default). Off when the owner offers copy elsewhere. */
    copy?: boolean;
}

/** Copy pretty JSON of `value`, fetching it first when it is a lazy placeholder. */
export async function copyJson(
    value: unknown, path: string, state: JsonViewState, loader?: Loader,
    write: (text: string) => Promise<void> = copyText,
) {
    if (isLazy(value) && loader) {
        await state.load(path, loader);
        const l = state.loaded(path);
        if (l?.status !== 'ready') return;
        value = l.value;
    }
    await write(JSON.stringify(value, null, 2));
}

/** Placeholder of an open lazy node: asks for the content itself, since the node may have been open from an earlier visit */
class LazyBody extends Component<{ path: string; state: JsonViewState; loader?: Loader }> {
    componentDidMount() { this.load(); }

    componentDidUpdate(prev: LazyBody['props']) {
        const { path, state, loader } = this.props;
        if (prev.path !== path || prev.state !== state || prev.loader !== loader) this.load();
    }

    private load() {
        const { path, state, loader } = this.props;
        if (loader) void state.load(path, loader);
    }

    render() { return <div className="json-children json-status">Loading…</div>; }
}

interface NodeProps extends JsonViewerProps { path: string; /** Unscoped path (key of `annotations`) */ at: string; name?: string | number; state: JsonViewState; last: boolean }

@with_meta_components
@observer
class JsonNode extends Component<NodeProps> {
    render() {
        const { name, path, at, state, loader, last, annotations } = this.props;
        const note = annotations?.[at] === undefined ? null : <span className="json-note">{` // ${annotations[at]}`}</span>;
        let value = this.props.value;
        const key = name === undefined ? null : <><span className="json-key">{typeof name === 'number' ? name : JSON.stringify(name)}</span>: </>;
        const comma = last ? null : ',';
        const d = describeValue(value);

        if (d.kind !== 'object' && d.kind !== 'array') {
            return <div className="json-row">{key}{this.leaf(value, d.kind)}{comma}{note}</div>;
        }

        const cached = d.lazy ? state.loaded(path) : undefined;
        if (cached?.status === 'ready') value = cached.value;
        const open = state.isOpen(path, d.lazy);
        const [lb, rb] = d.kind === 'array' ? ['[', ']'] : ['{', '}'];
        const unit = d.kind === 'array' ? (d.count === 1 ? 'item' : 'items') : (d.count === 1 ? 'key' : 'keys');
        const toggle = () => {
            state.toggle(path, d.lazy);
            if (!open && d.lazy && loader) state.load(path, loader);
        };

        return (
            <div className="json-node">
                <div className="json-row">
                    <button type="button" className="json-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`} onClick={toggle}>
                        <Icon path={open ? mdiChevronDown : mdiChevronRight} size={14} />
                    </button>
                    {key}{lb}
                    <span className="json-meta">{` ${d.count} ${unit} · ${formatBytes(d.size)}${d.lazy && cached?.status !== 'ready' ? ' · loads on expand' : ''}`}</span>
                    {!open && <>{rb}{comma}</>}
                    {note}
                </div>
                {open && this.children(value, cached)}
                {open && <div className="json-row">{rb}{comma}</div>}
            </div>
        );
    }

    private children(value: unknown, cached?: ReturnType<JsonViewState['loaded']>) {
        const { path, at, state, loader, annotations } = this.props;
        if (isLazy(value)) {
            if (cached?.status === 'error') {
                return <div className="json-children json-status json-error">Couldn't load: {cached.error} <button type="button" className="json-link" onClick={() => loader && state.load(path, loader)}>retry</button></div>;
            }
            return <LazyBody path={path} state={state} loader={loader} />;
        }
        const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value as object);
        return (
            <div className="json-children">
                {entries.map(([k, v], i) => (
                    <JsonNode key={k} name={Array.isArray(value) ? undefined : k} value={v} path={childPath(path, k)} at={childPath(at, k)} annotations={annotations} state={state} loader={loader} last={i === entries.length - 1} />
                ))}
            </div>
        );
    }

    private leaf(value: unknown, kind: string) {
        if (kind === 'string') {
            const { path, state } = this.props;
            const s = value as string;
            const { text, truncated } = state.isFullString(path) ? { text: s, truncated: false } : truncateString(s);
            return <>
                <span className="json-str">{JSON.stringify(text).replace(/"$/, truncated ? '' : '"')}{truncated && '…"'}</span>
                {truncated && <> <button type="button" className="json-link" onClick={() => state.showAll(path)}>show all</button></>}
            </>;
        }
        return <span className={kind === 'number' ? 'json-num' : 'json-lit'}>{value === undefined ? 'null' : String(value)}</span>;
    }
}

/** Collapsible JSON tree for large/nested values (design.md "JSON viewer"). */
@with_meta_components
@observer
export class JsonViewer extends Component<JsonViewerProps> {
    render() {
        const { value, loader, scope, annotations, copy = true } = this.props;
        const state = this.props.state ?? sharedJsonViewState();
        const root = scopedPath(scope, '$');
        return (
            <div className="json-viewer">
                {copy && (
                    <button type="button" className="icon-btn json-copy" aria-label="Copy value" onClick={() => copyJson(value, root, state, loader)}>
                        <Icon path={mdiContentCopy} size={14} />
                    </button>
                )}
                <JsonNode value={value} path={root} at="$" annotations={annotations} state={state} loader={loader} last />
            </div>
        );
    }
}
