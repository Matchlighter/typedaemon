/** Minimal slice of HTMLDialogElement we drive (keeps `syncModal` testable without a DOM). */
export interface ModalLike { open: boolean; showModal(): void; close(): void }

/** Make the native dialog's modal state match `open`. showModal() gives focus trapping, inert background and Esc for free. */
export function syncModal(dialog: ModalLike, open: boolean) {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
}

/** Esc fires a native `cancel` that would close the dialog behind our back; route it to the owner, who controls `open`. */
export function cancelFromEvent(e: { preventDefault(): void }, onCancel: () => void) {
    e.preventDefault();
    onCancel();
}
