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
type B = { id: number; inner: { n: number; t: string | null } | null }
type W = { id: number; inner: { n: number; t: string | null } }
const all: B[] = [{ id: 1, inner: null }, { id: 2, inner: { n: 2, t: null } }]
const kept = all.filter((r): r is W => r.inner !== null)
console.log(kept.length, kept[0]!.inner.n, kept[0]!.inner === all[1]!.inner)
