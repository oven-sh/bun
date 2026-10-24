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
type I = { n: number; t: string | null }
type J = { n: number; t: string }
type B = { id: number; inner: I }
type W = { id: number; inner: J }
const all: B[] = [{ id: 2, inner: { n: 2, t: "t" } }]
const kept = all.filter((r): r is W => r.inner.t !== null)
const j: J = kept[0]!.inner
console.log(j.t.length, j === all[0]!.inner)
