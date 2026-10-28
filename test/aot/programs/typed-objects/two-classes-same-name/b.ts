export class Item { #own = 0; v = "text"; other = 2; }
export function makeB(): Item { return new Item(); }
export function readB(item: Item): string { return item.v; }
