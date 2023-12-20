
import { getInheritedHiddenProp } from "@matchlighter/common_library/object"
import { Decorator } from "@matchlighter/common_library/decorators/20223fills"

// @ts-ignore
Symbol.metadata ??= Symbol("Symbol.metadata");

interface DecOnceOpts {
    loud?: boolean;
    key?: any;
}

export function dec_once<T extends Decorator>(dec: T): T
export function dec_once<T extends Decorator>(opts: DecOnceOpts, dec: T): T
export function dec_once<T extends Decorator>(a, b?): T {
    if (typeof a == "function") {
        b = a;
        a = {};
    }

    let dec: Decorator = b;
    let opts: DecOnceOpts = { key: dec, loud: false, ...(a ?? {}) }

    const { key, loud } = opts;

    return ((access, context: ClassMemberDecoratorContext) => {
        if (isDecoratedWith(context, key)) {
            if (loud) throw new Error(`'${String(context.name)}' is already decorated with '${String(key)}'`)
            return
        };
        markDecoratedWith(context, key);
        return dec(access, context as any);
    }) as any;
}

function _chainDecorators<T extends Decorator>(access: Parameters<T>[0], context: Parameters<T>[1], decorators: T[]) {
    const inits = [];
    let current = access;
    for (let dec of decorators) {
        if (!dec) continue;
        current = {
            ...current,
            ...(dec(current, context as any) ?? {}),
        }
        inits.push(current.init);
        delete current.init;
    }
    inits.reverse();
    return {
        ...current,
        init(value) {
            for (let init of inits) {
                if (!init) continue
                value = init.call(this, value);
            }
            return value;
        }
    };
}

export function chainedDecorators<T extends Decorator>(decorators: T[]): T {
    return ((access, context) => {
        return _chainDecorators(access, context, decorators);
    }) as any
}

function getSore(context: ClassMemberDecoratorContext) {
    return getInheritedHiddenProp(context.metadata, `_${String(context.name)}_decorators`, "set");
}

export function isDecoratedWith(context: ClassMemberDecoratorContext, decorator: any) {
    const store = getSore(context);
    return store.has(decorator);
}

export function markDecoratedWith(context: ClassMemberDecoratorContext, decorator: any) {
    const store = getSore(context);
    store.add(decorator);
}

// TODO Support global, mutually exclusive maps
// export function assertNotDecoratedWith(context: ClassMemberDecoratorContext, decorator: any, newDec: any) {
//     if (isDecoratedWith(context, decorator)) {
//         const oldDecName = typeof decorator == "function" ? decorator.name : String(decorator);
//         throw new Error(`Decorator '${newDec}' is incompatible with previously applied '${oldDecName}'`);
//     }
// }
