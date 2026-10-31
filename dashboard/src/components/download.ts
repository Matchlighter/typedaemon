/** Save `text` as a file via a transient object-URL link (works in HA panel iframes, unlike the File System API) */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
