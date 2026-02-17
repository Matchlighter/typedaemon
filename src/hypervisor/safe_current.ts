
export let current: typeof import("./current").current = {} as any;

export function implementCurrent(curr: typeof import("./current").current) {
    current = curr;
}
