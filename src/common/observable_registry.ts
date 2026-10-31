import { TypedEmitter } from "tiny-typed-emitter";

/** Handle of a registered item */
export interface RegistryEntry<T> {
    /** Merge `patch` into the item (keys set to undefined are dropped); a no-op patch emits nothing */
    update(patch: Partial<T>): void;
    /** Unregister; emits only if the item was still there */
    remove(): void;
}

/**
 * Items with a numeric id that something wants to list and watch: `change` fires (with `Args`, fixed per item at
 * `register`) on every registration, effective update and removal. Subclasses wrap `register` in their own `add`.
 */
export class ObservableRegistry<T extends { id: number }, Args extends any[] = []> extends TypedEmitter<{
    change: (...args: Args) => void;
}> {
    private nextId = 1;
    protected items = new Map<number, T>();

    protected register(def: Omit<T, 'id'>, ...args: Args): RegistryEntry<T> {
        const id = this.nextId++;
        this.items.set(id, { id, ...def } as T);
        const emit = () => (this.emit as (event: 'change', ...a: Args) => boolean)('change', ...args);
        emit();
        return {
            update: patch => {
                const cur = this.items.get(id);
                if (!cur) return;
                const next = Object.fromEntries(Object.entries({ ...cur, ...patch }).filter(([, v]) => v !== undefined)) as T;
                if (JSON.stringify(next) === JSON.stringify(cur)) return;
                this.items.set(id, next);
                emit();
            },
            remove: () => {
                if (this.items.delete(id)) emit();
            },
        };
    }

    list(): T[] {
        return [...this.items.values()];
    }
}
