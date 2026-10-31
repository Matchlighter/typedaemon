import type { Store } from '@matchlighter/meta_components';
import { makeObservable, observable, runInAction } from 'mobx';

/**
 * True for `ms` after `token()` changes (not on mount, not for an undefined token).
 * Drive a `.flash` class (app.css) and any "changed" affordance from it. Use as a meta_components `@store` field and
 * `check()` after every update (props are not mobx-tracked, so the component tells it when they may have changed):
 *
 *   @store flash = new Flash(() => this.props.row.state, 1200);
 *   componentDidUpdate() { this.flash.check(); }
 *   render() { return <tr className={this.flash.active ? 'flash' : undefined}>...; }   // inside an observer class
 */
export class Flash implements Store {
    active = false;
    private seen: unknown;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private token: () => unknown, private ms = 1500) { makeObservable(this, { active: observable }); }

    activate() {
        this.seen = this.token();
        return () => clearTimeout(this.timer);
    }

    check() {
        const t = this.token();
        if (Object.is(this.seen, t)) return;
        this.seen = t;
        if (t === undefined) return;
        clearTimeout(this.timer);
        runInAction(() => { this.active = true; });
        this.timer = setTimeout(() => runInAction(() => { this.active = false; }), this.ms);
    }
}
