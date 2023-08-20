
import { Constructor } from "type-fest";

export interface FuncOrNew<F extends (...params: any) => any, N extends Constructor<any>> {
    new(...params: ConstructorParameters<N>): InstanceType<N>
    (...params: Parameters<F>): ReturnType<F>
}

export function funcOrNew<F extends (...params: any) => any, N extends Constructor<any>>(func: F, construct: N): FuncOrNew<F, N> {
    return function (...params) {
        if (new.target) {
            return new construct(...params);
        } else {
            return func(...params);
        }
    } as any
}

export function decOrFunc<D extends (target, context: DecoratorContext) => void, F extends (...params: any[]) => any>(decorator: D, func: F): D & F {
    return function (...params) {
        if (params.length == 2 && params[1].kind) {
            // @ts-ignore
            return decorator(...params);
        } else {
            return func(...params);
        }
    } as any
}

// type MCD = (target, context: DecoratorContext) => void;
// type MCC = Constructor<any>;
// type MCI = (...params: any[]) => any;

// function multicall<D extends (...params: any) => any, N extends Constructor<any>>({ decorator:  }): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N>
// function multicall<D extends (...params: any) => any, N extends Constructor<any>>(decMethod: D, construct: N): DecOrNew<D, N> {
//     return function (...params) {
//         if (new.target) {
//             return new construct(...params);
//         } else {
//             return decMethod(...params);
//         }
//     } as any
// }
