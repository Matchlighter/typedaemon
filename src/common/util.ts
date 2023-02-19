
import * as babel from "@babel/core";

export type DeepReadonly<T> =
    T extends (infer R)[] ? DeepReadonlyArray<R> :
    T extends Function ? T :
    T extends object ? DeepReadonlyObject<T> :
    T;

interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> { }

type DeepReadonlyObject<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export const convertTypescript = async (source: string, filename: string) => {
    const BABEL_CONFIG: babel.TransformOptions = {
        targets: {
            esmodules: true,
            node: "current",
        },
        presets: [
            ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
            ['@babel/preset-typescript'],
        ],
    }
    const result = await babel.transformAsync(source, {
        filename,
        ...BABEL_CONFIG,
    });
    return result.code
}

export function pojso(pbj: any) {
    // TODO
    return true;
}
