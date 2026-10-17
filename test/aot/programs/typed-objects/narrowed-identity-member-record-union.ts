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
type B = { id: number; inner: { k: "a"; t: string | null } | { k: "b"; u: number | null } }
type W = { id: number; inner: { k: "a"; t: string } | { k: "b"; u: number } }
const all: B[] = [{ id: 1, inner: { k: "a", t: "t" } }, { id: 2, inner: { k: "b", u: 2.5 } }, { id: 3, inner: { k: "b", u: null } }]
const kept = all.filter((r): r is W => r.inner.k === "a" ? r.inner.t !== null : r.inner.u !== null)
console.log(kept.length, kept.map(r => r.inner.k === "a" ? r.inner.t.length : r.inner.u + 1).join(), kept[1]!.inner === all[1]!.inner)
