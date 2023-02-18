export class InvertedWeakMap<K extends string | symbol, V extends object> {
    private _map = new Map<K, WeakRef<V>>()
    private _registry: FinalizationRegistry<K>

    constructor() {
        this._registry = new FinalizationRegistry<K>((key) => {
            this._map.delete(key)
        })
    }

    set(key: K, value: V) {
        this._map.set(key, new WeakRef(value))
        this._registry.register(value, key)
    }

    get(key: K): V | undefined {
        const ref = this._map.get(key)
        if (ref) {
            return ref.deref()
        }
    }

    has(key: K): boolean {
        return this._map.has(key) && this.get(key) !== undefined
    }
}
