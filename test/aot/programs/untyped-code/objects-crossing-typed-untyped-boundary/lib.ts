export interface Options { id: string; width?: number; tags?: string[] }
export interface Item { id: number; label: string; done: boolean; meta?: { seen: number } }
export interface State { user: { name: string }; items: Item[]; winner: Item | null; label: string | null }
let state: State = { user: { name: "u" }, items: [], winner: null, label: null }
export function getState(): State { return state }
export function setState(next: State): void { state = next }
export function isCurrent(s: State): boolean { return s === state }
export function isCurrentUser(u: { name: string }): boolean { return u === state.user }
export function echo(o: Options): Options { return o }
export function same(a: Options, b: Options): boolean { return a === b }
export function touch(item: Item): void { item.done = true; item.label += "!"; (item.meta ??= { seen: 0 }).seen++ }
export function addTag(o: Options, tag: string): void { (o.tags ??= []).push(tag) }
export function sortById(list: Item[]): Item[] { return list.sort((a, b) => b.id - a.id) }
const registry = new Set<Options>()
export function register(o: Options): number { registry.add(o); return registry.size }
export function unregister(o: Options): boolean { return registry.delete(o) }
export function adder(): [Item[], (item: Item) => number] { const kept: Item[] = []; return [kept, item => kept.push(item)] }
export class Tank { last?: Item; count = 0; take(item: Item): number { this.last = item; return ++this.count } holds(item: Item): boolean { return this.last === item } }
export const kept = { id: 9, label: "kept", inner: { n: 1 } }
export function keptText(): string { return kept.label + kept.id + kept.inner.n }
export function isKeptInner(inner: { n: number }): boolean { return inner === kept.inner }
// Not imported by untyped code, and with unique property names: its types stay facts.
export interface Private { secretNumber: number; secretText: string }
export function makePrivate(n: number): Private { return { secretNumber: n, secretText: "s" + n } }
export function sumPrivate(list: Private[]): number { let sum = 0; for (const p of list) sum += p.secretNumber; return sum }
