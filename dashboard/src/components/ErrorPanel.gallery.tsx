import type { GallerySection } from '../gallery';
import { ErrorPanel } from './ErrorPanel';

export default {
    title: 'Error panel',
    render: () => (
        <ErrorPanel phase="starting" message="TypeError: Cannot read properties of undefined (reading 'turn_on')" codeFrame={{ file: 'apps/lights/index.ts', line: 42, col: 17, lines: [{ n: 41, text: 'const door = this.ha.entity(…);' }, { n: 42, text: "if (door.previous.state === 'on') {" }, { n: 43, text: "  await this.notify('Garage…');" }] }}
            logsHref="#/apps/lights/logs"
            blockedCalls={[{ source: 'door', target: 'lights', method: 'open', timeoutAt: Date.now() + 57 * 60_000 }]}
            plugins={[{ id: 'home_assistant', type: 'home_assistant', state: 'started', connection: 'reconnecting' }, { id: 'mqtt', type: 'mqtt', state: 'started', connection: 'connected' }]}
            frames={[
                { fn: 'Lights.init', file: 'apps/lights/index.ts', line: 42, col: 17 },
                { fn: 'Lights.setup', file: 'apps/lights/index.ts', line: 18, col: 5 },
                { file: 'apps/lights/util.ts', line: 9 },
                { fn: 'AppInstance.boot', file: '/srv/typedaemon/hypervisor/app_instance.ts', line: 211, col: 9 },
            ]} />
    ),
} satisfies GallerySection;
