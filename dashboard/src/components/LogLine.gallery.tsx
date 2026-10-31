import { Component } from 'react';
import type { GallerySection } from '../gallery';
import { LogLine, type LogEntry } from './LogLine';

const t0 = new Date(2026, 9, 19, 14, 6, 41, 123).getTime();
const stack = [
    { fn: 'Lights.activate', file: 'apps/lights/index.ts', line: 42, col: 17, href: '#' },
    { fn: 'Scene.apply', file: 'apps/lights/scene.ts', line: 118, col: 9, href: '#' },
    { file: 'apps/lights/util.ts', line: 7 },
];

const samples: LogEntry[] = [
    { ts: t0, level: 'debug', source: 'lights', message: 'tick 3 entities pending' },
    { ts: t0 + 12, level: 'info', source: 'lights', message: 'Scene "evening" applied' },
    { ts: t0 + 340, level: 'warn', source: 'home_assistant', message: 'Reconnecting in 5s' },
    { ts: t0 + 801, level: 'lifecycle', source: 'lights', message: 'compiling -> starting' },
    { ts: t0 + 1500, level: 'error', source: 'lights', message: "TypeError: Cannot read properties of undefined (reading 'brightness')", stack },
    { ts: t0 + 1502, level: 'error', source: 'notifier', message: 'Failed to send (no stack)' },
];

/** Many rows in a fixed-height scroller; expansion state lives in the owner, as it must with a virtual list that unmounts rows. */
class Demo extends Component<{}, { open: Record<number, boolean> }> {
    state = { open: {} as Record<number, boolean> };
    render() {
        const rows = Array.from({ length: 200 }, (_, i) => ({ ...samples[i % samples.length], ts: t0 + i * 37 }));
        return (
            <div style={{ height: 220, overflow: 'auto', border: '1px solid var(--div)', borderRadius: 8, background: 'var(--card)' }}>
                {rows.map((e, i) => (
                    <LogLine key={i} entry={e} expanded={!!this.state.open[i]} onToggle={v => this.setState(s => ({ open: { ...s.open, [i]: v } }))} />
                ))}
            </div>
        );
    }
}

export default {
    title: 'Log line',
    render: () => (
        <>
            <div className="lbl">All levels (error with stack: click or Tab + Enter)</div>
            <div style={{ border: '1px solid var(--div)', borderRadius: 8, background: 'var(--card)', margin: '6px 0 12px' }}>
                {samples.map((e, i) => <LogLine key={i} entry={e} />)}
            </div>
            <div className="lbl">Scrolling list, owner-held expansion state</div>
            <div style={{ marginTop: 6 }}><Demo /></div>
        </>
    ),
} satisfies GallerySection;
