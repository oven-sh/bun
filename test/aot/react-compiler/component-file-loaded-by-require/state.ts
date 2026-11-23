export interface Item { id: number; label: string }
export function makeItem(id: number): Item { return { id, label: "item " + id }; }
export function describe(item: Item): string { return item.id + ": " + item.label; }
