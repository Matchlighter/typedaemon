import { mdiMagnify } from '@mdi/js';
import { Icon } from './Icon';
import { openPalette } from './CommandPalette';

/** The modifier shown in the hint (Cmd on Apple platforms, Ctrl elsewhere); the palette itself accepts both */
const hotkeyHint = () => (/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘ K' : 'Ctrl K');

/** Search-field-looking button for the header that opens the command palette (the discoverable twin of the hotkey) */
export function SearchTrigger() {
    return (
        <button type="button" className="search-trigger" onClick={openPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
            <Icon path={mdiMagnify} size={16} />
            <span className="search-text">Jump to app, entity, storage key…</span>
            <kbd>{hotkeyHint()}</kbd>
        </button>
    );
}
