/** happy-dom lacks HTMLDialogElement.showModal/close; stub them (open flag only) so native-<dialog> components can be tested. Call once at file top. */
export function stubDialog() {
    const proto = HTMLDialogElement.prototype as any;
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
