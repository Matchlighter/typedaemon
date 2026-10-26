// Type-level test: the module is imported type-only to avoid hypervisor import cycles at runtime.
type When = typeof import("./when").when;
declare const when: When;

describe("when typing", () => {
    it("accepts a void/async action callback (checked by tsc)", () => {
      const check = () => {
        class A {
            notify() { }
            setup() {
                return when<A>(() => true, { for: 600 })(() => this.notify());
            }
        }
        const f: () => void = when<A>(() => true)(() => { });
        const g: () => void = when<A>(() => true)(async () => { });
        void [A, f, g];
      };
      expect(check).toBeDefined();
    });
});
