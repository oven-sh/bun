// Narrowing a record from one closed record type to another must not copy it.
type Item = { kind: "prompt" | "other"; name: string }
type Built = { item: Item | undefined; path: string }
type WithPath = { item: Item; path: string }
function build(names: string[]): Built[] { return names.map((n): Built => ({ item: n === "" ? undefined : { kind: "prompt", name: n }, path: "/p/" + n })) }
function made(): WithPath { return { item: { kind: "other", name: "made" }, path: "/made" } }
function report(label: string, narrowed: WithPath | undefined, original: Built) {
  if (narrowed === undefined) { console.log(label, "nothing"); return }
  narrowed.path += "!"
  narrowed.item.name += "?"
  console.log(label, narrowed === original, original.path, original.item?.name, narrowed.path, narrowed.item.name, made().path)
}
const built = build(["a", "", "b"])
type B = { v: number | null; next: B | null }
type W = { v: number; next: W | null }
function isW(r: B): r is W { return r.v !== null && (r.next === null || isW(r.next)) }
const chain: B = { v: 1.5, next: { v: 2.5, next: { v: 3.5, next: null } } }
if (isW(chain)) { let sum = 0; for (let at: W | null = chain; at; at = at.next) sum += at.v; console.log(sum, chain.next === (chain as B).next, chain.next!.next!.v) }
