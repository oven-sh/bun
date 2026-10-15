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
type Ok = { ok: true; value: number }
type Failed = { ok: false; reason: string }
const results: (Ok | Failed)[] = [{ ok: true, value: 1.5 }, { ok: false, reason: "r" }]
const oks = results.filter((r): r is Ok => r.ok)
oks[0]!.value += 1
console.log("discriminant", oks[0] === results[0], (results[0] as Ok).value)
for (const r of results) { if (r.ok) { r.value += 1; console.log(r === results[0], r.value) } else { r.reason += "!"; console.log(r === results[1], (results[1] as Failed).reason) } }
