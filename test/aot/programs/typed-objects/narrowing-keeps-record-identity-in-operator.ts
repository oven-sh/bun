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
type Named = { name: string; size: number }
type Sized = { size: number; label: string }
const both: (Named | Sized)[] = [{ name: "n", size: 1.5 }, { size: 2.5, label: "l" }]
for (const x of both) { if ("name" in x) { x.size += 1; console.log("in", x === both[0], x.name, both[0]!.size) } else { x.size += 2; console.log("not in", x === both[1], x.label, both[1]!.size) } }
