import { ObservableRegistry } from "./observable_registry";

interface Item { id: number; name: string; extra?: number }

class Reg extends ObservableRegistry<Item, [tag: string]> {
    add(name: string) { return this.register({ name }, 'tag') }
}

describe('ObservableRegistry', () => {
    it('lists items with increasing ids and emits change (with the per-item args) on add/update/remove', () => {
        const reg = new Reg();
        const changes: string[] = [];
        reg.on('change', tag => changes.push(tag));
        const a = reg.add('a');
        const b = reg.add('b');
        expect(reg.list()).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
        a.update({ extra: 1 });
        b.remove();
        expect(reg.list()).toEqual([{ id: 1, name: 'a', extra: 1 }]);
        expect(changes).toHaveLength(4);
        expect(changes.every(t => t === 'tag')).toBe(true);
    });

    it('stays quiet for no-op updates and repeated/late calls; undefined patch values drop the key', () => {
        const reg = new Reg();
        const a = reg.add('a');
        a.update({ extra: 1 });
        const changes = jest.fn();
        reg.on('change', changes);
        a.update({ extra: 1 });
        a.update({ extra: undefined });
        expect(reg.list()).toEqual([{ id: 1, name: 'a' }]);
        expect(changes).toHaveBeenCalledTimes(1);
        a.remove();
        a.remove();
        a.update({ extra: 5 });
        expect(changes).toHaveBeenCalledTimes(2);
        expect(reg.list()).toEqual([]);
    });
});
