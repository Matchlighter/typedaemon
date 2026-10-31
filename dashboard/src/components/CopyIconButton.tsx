import { mdiCheck, mdiContentCopy } from '@mdi/js';
import { Component } from 'react';
import { ActionError } from './ActionError';
import { copyText } from './clipboard';
import { Icon } from './Icon';

/** Icon-only copy button: swaps to a check briefly after copying, and says so (role=alert) when the clipboard is unavailable. */
export class CopyIconButton extends Component<{ text: string; label: string }> {
    state: { copied: boolean; error?: string } = { copied: false };
    private timer: ReturnType<typeof setTimeout> | undefined;

    componentWillUnmount() { clearTimeout(this.timer); }

    private copy = async () => {
        try {
            await copyText(this.props.text);
            this.setState({ copied: true, error: undefined });
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.setState({ copied: false }), 1500);
        } catch {
            this.setState({ copied: false, error: "Couldn't copy; select the text and copy manually." });
        }
    };

    render() {
        const { copied, error } = this.state;
        const { label } = this.props;
        return (
            <>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={label} title={copied ? 'Copied' : label} onClick={() => void this.copy()}>
                    <Icon path={copied ? mdiCheck : mdiContentCopy} size={14} />
                </button>
                <ActionError error={error} />
            </>
        );
    }
}
