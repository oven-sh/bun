export class Owner { readonly name = "owner"; uses = 0; use(): number { return ++this.uses; } }
export interface Place { readonly start: string; top: string }
export interface Root { readonly owner: Owner; readonly id: string; place: Place | null; readonly notes: string[] }
export interface Item { id: number; label: string; done: boolean }
export interface Choice { root: Root; item: Item; note?: string }
let binding: Root = { owner: new Owner(), id: "r1", place: { start: "/a", top: "/a/b" }, notes: [] };
export function currentRoot(): Root { return binding; }
export function topOf(root: Root): string | null { return root.place === null ? null : root.place.top; }
export function describe(root: Root): string { return root.id + ":" + root.owner.uses + ":" + topOf(root) + ":" + root.notes.join("+"); }
export const items: Item[] = [{ id: 1, label: "one", done: false }, { id: 2, label: "two", done: true }];
export function describeChoice(choice: Choice): string { return describe(choice.root) + "/" + choice.item.id + choice.item.label + "/" + choice.note; }
export function isCurrent(choice: Choice): boolean { return choice.root === binding && items.includes(choice.item); }
export function finish(choice: Choice): void { choice.item.done = true; choice.root.notes.push("finished " + choice.item.id); choice.note = "done"; }
let kept: Choice | undefined;
export function keep(choice: Choice): void { kept = choice; }
export function keptChoice(): Choice | undefined { return kept; }
