// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' });

describe('copyText', () => {
    it('uses the async clipboard API when it works', async () => {
        const writeText = vi.fn(async () => { });
        await copyText('hi', { clipboard: { writeText } });
        expect(writeText).toHaveBeenCalledWith('hi');
    });

    it('falls back to execCommand when the async API is missing (e.g. cross-origin iframe, insecure context)', async () => {
        let copied: string | undefined;
        document.execCommand = vi.fn(() => { copied = (document.activeElement as HTMLTextAreaElement).value; return true });
        await copyText('/c/config.yaml', {});
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(copied).toBe('/c/config.yaml');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back when the async API rejects (permission policy)', async () => {
        document.execCommand = vi.fn(() => true);
        await copyText('x', { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } });
        expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    it('rejects when neither works', async () => {
        document.execCommand = vi.fn(() => false);
        await expect(copyText('x', {})).rejects.toThrow(/copy/i);
        expect(document.querySelector('textarea')).toBeNull();
    });
});
