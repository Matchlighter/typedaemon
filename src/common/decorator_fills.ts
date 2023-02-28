
export type ClassAccessorDecorator<This = any, Value = any> = (
    value: ClassAccessorDecoratorTarget<This, Value>,
    context: ClassAccessorDecoratorContext
) => ClassAccessorDecoratorResult<This, Value> | void;

export type ClassGetterDecorator<This = any, Value = any> = (
    value: (this: This) => Value,
    context: ClassGetterDecoratorContext
) => Function | void;

export type ClassSetterDecorator<This = any, Value = any> = (
    value: (this: This, value: Value) => void,
    context: ClassSetterDecoratorContext
) => Function | void;

export type ClassMethodDecorator<This = any, Value extends ((...p: any[]) => any) = any> = (
    value: Value,
    context: ClassMethodDecoratorContext<This, Value>
) => Value | void;
