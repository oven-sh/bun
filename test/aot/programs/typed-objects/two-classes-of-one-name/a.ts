export class Item { #own = 0; v = 1; only = true; }
export function makeA(): Item { return new Item(); }
export function readA(item: Item): number { return item.v; }
