import '../styles/segmented.css';

export interface SegmentedOption<V extends string> {
    value: V;
    label: string;
    /** Shown in a count bubble */
    count?: number;
    /** Count bubble in warning color (e.g. unlinked) */
    warn?: boolean;
    /** Count bubble in error color (e.g. dead apps); ignored when the count is 0 */
    err?: boolean;
}

const cntClass = (o: SegmentedOption<string>) => o.err && o.count ? 'cnt cnt-e' : o.warn ? 'cnt cnt-w' : 'cnt';

export interface SegmentedProps<V extends string> {
    options: SegmentedOption<V>[];
    value: V;
    onChange: (value: V) => void;
    /** Accessible name of the group */
    label: string;
}

/** Bordered pill group of toggle buttons (design.md "Segmented control"). */
export function Segmented<V extends string>({ options, value, onChange, label }: SegmentedProps<V>) {
    return (
        <div className="seg" role="group" aria-label={label}>
            {options.map(o => (
                <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
                    {o.label}{o.count !== undefined && <span className={cntClass(o)}>{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

export interface SegmentedMultiProps<V extends string> extends Omit<SegmentedProps<V>, 'value' | 'onChange'> {
    values: readonly V[];
    /** Selected values, in the options' order */
    onChange: (values: V[]) => void;
}

/** Same look as `Segmented`, but any number of options can be on (e.g. which log levels to show). */
export function SegmentedMulti<V extends string>({ options, values, onChange, label }: SegmentedMultiProps<V>) {
    const toggle = (v: V) => onChange(options.map(o => o.value).filter(x => (x === v) !== values.includes(x)));
    return (
        <div className="seg" role="group" aria-label={label}>
            {options.map(o => (
                <button key={o.value} type="button" aria-pressed={values.includes(o.value)} onClick={() => toggle(o.value)}>
                    {o.label}{o.count !== undefined && <span className={cntClass(o)}>{o.count}</span>}
                </button>
            ))}
        </div>
    );
}
