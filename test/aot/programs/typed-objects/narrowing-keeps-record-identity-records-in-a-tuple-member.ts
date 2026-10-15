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
type B = { id: number; pair: [{ t: string | null; a: number }, { u: number | undefined; b: number }] }
type W = { id: number; pair: [{ t: string; a: number }, { u: number; b: number }] }
const all: B[] = [{ id: 2, pair: [{ t: "a", a: 1.5 }, { u: 2.5, b: 3.5 }] }]
const kept = all.filter((r): r is W => r.pair[0].t !== null && r.pair[1].u !== undefined)
console.log(kept[0]!.pair[0].t.length, kept[0]!.pair[1].u + 1, kept[0]!.pair[0] === all[0]!.pair[0], kept[0]!.pair[1] === all[0]!.pair[1])
