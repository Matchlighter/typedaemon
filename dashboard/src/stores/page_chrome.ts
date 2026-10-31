import { makeAutoObservable, observable } from 'mobx';

/** What the phone top bar shows in place of the section label */
export interface PageChromeState {
    title: string;
    /** Shows a back chevron linking here */
    backHref?: string;
}

/**
 * Lets a detail view name itself in the app chrome (phone top bar: back chevron + title).
 * `set` returns the disposer; only the latest claim shows, and disposing a stale claim is a no-op.
 */
export class PageChrome {
    current: PageChromeState | undefined = undefined;

    constructor() { makeAutoObservable(this, { current: observable.ref }, { autoBind: true }) }

    set(state: PageChromeState) {
        const claim = { ...state };
        this.current = claim;
        return () => { if (this.current === claim) this.current = undefined };
    }
}
