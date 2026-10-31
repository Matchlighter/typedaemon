import { mdiClose } from '@mdi/js';
import { Icon } from './Icon';
import '../styles/filterchips.css';

export interface FilterChipOption<V extends string> {
    value: V;
    label: string;
}

export interface FilterChipsProps<V extends string> {
    options: FilterChipOption<V>[];
    /** Values that are on */
    values: readonly V[];
    /** Selected values, in the options' order */
    onChange: (values: V[]) => void;
    /** Accessible name of the group; also the prefix of the first chip that is on ("source: all apps") */
    label: string;
}

/** Removable chips for the values that are on (first one prefixed with `label`, the rest "+ x"); the ones that are off show as dashed "+ x" buttons to add them back. */
export function FilterChips<V extends string>({ options, values, onChange, label }: FilterChipsProps<V>) {
    const set = (v: V, on: boolean) => onChange(options.map(o => o.value).filter(x => x === v ? on : values.includes(x)));
    const firstOn = options.find(o => values.includes(o.value))?.value;
    return (
        <div className="fchips" role="group" aria-label={label}>
            {options.map(o => values.includes(o.value)
                ? (
                    <span key={o.value} className="fchip">
                        {o.value === firstOn ? `${label}: ${o.label}` : `+ ${o.label}`}
                        <button type="button" aria-label={`Hide ${o.label}`} onClick={() => set(o.value, false)}><Icon path={mdiClose} size={12} /></button>
                    </span>
                )
                : <button key={o.value} type="button" className="fchip fchip-off" aria-label={`Show ${o.label}`} onClick={() => set(o.value, true)}>+ {o.label}</button>)}
        </div>
    );
}
