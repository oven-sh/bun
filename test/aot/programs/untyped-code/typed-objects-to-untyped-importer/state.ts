export class Owner { readonly name = "owner"; uses = 0; use(): number { return ++this.uses; } }
export interface Place { readonly start: string; top: string }
export interface Root { readonly owner: Owner; readonly id: string; place: Place | null; readonly notes: string[]; label?: string }
export interface Item { id: number; label: string }
let binding: Root = { owner: new Owner(), id: "r1", place: { start: "/a", top: "/a/b" }, notes: [] };
export function currentRoot(): Root { return binding; }
export function isCurrent(root: Root): boolean { return root === binding; }
export function topOf(root: Root): string | null { return root.place === null ? null : root.place.top; }
export function describe(): string { const root = currentRoot(); return root.id + ":" + root.owner.uses + ":" + topOf(root) + ":" + root.notes.join("+") + ":" + root.label; }
const items: Item[] = [{ id: 1, label: "one" }];
export function allItems(): Item[] { return items; }
export function labels(): string { let text = ""; for (const item of items) text += item.id + item.label + ";"; return text; }
export function each(visit: (item: Item, root: Root) => unknown): unknown[] { return items.map(item => visit(item, binding)); }
export const table = new Map<string, Item>([["one", items[0]!]]);
export function labelIn(key: string): string | undefined { return table.get(key)?.label; }
