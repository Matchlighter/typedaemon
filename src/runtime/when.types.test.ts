import { typeTest } from "../../test/helpers/types";

declare const when: typeof import("./when").when;

describe("when typing", () => {
    typeTest("accepts a void/async action callback", () => {
        class A {
            notify() { }
            setup() {
                return when<A>(() => true, { for: 600 })(() => this.notify());
            }
        }
        const f: () => void = when<A>(() => true)(() => { });
        const g: () => void = when<A>(() => true)(async () => { });
        void [A, f, g];
    });

    typeTest("rejects a non-function callback", () => {
        // @ts-expect-error not a callback
        when<object>(() => true)(123);
    });
});
