import { typeTest } from "../../../test/helpers/types";
import type { ICancellablePromise } from "../resumable/resumable_promise";
import type { script as scriptT } from ".";

declare const script: typeof scriptT;
class Sample { }

describe("script decorator typing", () => {
    typeTest("accepts async methods (no TS1270)", () => {
        class Sample {
            @script({ mode: "single" })
            async run(at: number): Promise<void> { }
        }
        void Sample;
    });

    typeTest("wrapped call keeps args/return and adds cancel()", () => {
        const wrapped = script({ mode: "single" })(async function (this: Sample, at: number) { return "x"; });

        const args: Parameters<typeof wrapped> = [1];
        const result: ReturnType<typeof wrapped> = null;
        const asPromise: Promise<string> = result;
        const asCancellable: ICancellablePromise = result;
        void [args, asPromise, asCancellable];

        // @ts-expect-error wrong argument type
        const badArgs: Parameters<typeof wrapped> = ["nope"];
        // @ts-expect-error not a plain Promise<number>
        const badResult: Promise<number> = result;
        void [badArgs, badResult];
    });
});
