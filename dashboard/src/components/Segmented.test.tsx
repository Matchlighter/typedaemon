import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Segmented, SegmentedMulti } from './Segmented';

describe('Segmented', () => {
    it('marks the selected option pressed and shows counts', () => {
        const out = renderToString(<Segmented label="State" value="b" onChange={() => { }} options={[{ value: 'a', label: 'A', count: 3 }, { value: 'b', label: 'B' }]} />);
        expect(out).toContain('aria-label="State"');
        expect(out).toMatch(/aria-pressed="false"[^>]*>A<span class="cnt">3<\/span>/);
        expect(out).toMatch(/aria-pressed="true"[^>]*>B</);
    });
});

describe('SegmentedMulti', () => {
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }];

    it('marks every selected option pressed', () => {
        const out = renderToString(<SegmentedMulti label="Level" values={['a', 'c']} onChange={() => { }} options={options} />);
        expect(out).toMatch(/aria-pressed="true"[^>]*>A</);
        expect(out).toMatch(/aria-pressed="false"[^>]*>B</);
        expect(out).toMatch(/aria-pressed="true"[^>]*>C</);
    });

    it('toggles one option, keeping the options\' order', () => {
        const changes: string[][] = [];
        const el = SegmentedMulti({ label: 'Level', values: ['c'], onChange: v => changes.push(v), options });
        const buttons = (el.props.children as any[]);
        buttons[0].props.onClick();
        buttons[2].props.onClick();
        expect(changes).toEqual([['a', 'c'], []]);
    });
});
