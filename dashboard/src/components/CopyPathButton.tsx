import { Component } from 'react';
import { ActionError } from './ActionError';
import { copyText } from './clipboard';

/** "Copy path" button: flashes `Copied`, and says so (role=alert) when the clipboard is unavailable */
export class CopyPathButton extends Component<{ path: string }> {
    state: { copied: boolean; error?: string } = { copied: false };
    private timer: ReturnType<typeof setTimeout> | undefined;

    componentWillUnmount() { clearTimeout(this.timer); }

    private copy = async () => {
        try {
            await copyText(this.props.path);
            this.setState({ copied: true, error: undefined });
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.setState({ copied: false }), 1500);
        } catch {
            this.setState({ copied: false, error: "Couldn't copy the path; select it above and copy manually." });
        }
    };

    render() {
        const { copied, error } = this.state;
        return (
            <>
                <button type="button" className="btn btn-sm" onClick={() => void this.copy()}>{copied ? 'Copied' : 'Copy path'}</button>
                <ActionError error={error} />
            </>
        );
    }
}
