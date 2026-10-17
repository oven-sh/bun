// A declared member of an object that typed code made is turned into a getter with Object.defineProperty. Reads of the member run the getter from then on, as in JavaScript.
function row(name: string, f: () => unknown) { try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": threw " + (e instanceof TypeError ? "TypeError" : String(e))) } }
type Item = { title: string; hint?: string; note?: string; size: number; on: boolean; tags: string[] }
type Given = { title: string | (() => string); hint?: string | (() => string); note?: string | (() => string) }
function wire(item: Item, key: "title" | "hint" | "note", given: string | (() => string) | undefined) {
  if (typeof given !== "function") return
  Object.defineProperty(item, key, { get: given, enumerable: true, configurable: true })
}
function make(d: Given): Item {
  const item: Item = { title: typeof d.title === "function" ? "" : d.title, hint: typeof d.hint === "function" ? undefined : d.hint, note: typeof d.note === "function" ? undefined : d.note, size: 1.5, on: true, tags: ["t"] }
  wire(item, "title", d.title); wire(item, "hint", d.hint); wire(item, "note", d.note)
  return item
}
function titleOf(item: Item): string { return item.title + "/" + (item.hint ?? "-") + "/" + (item.note ?? "-") + "/" + item.size + item.on + item.tags.join() }
let count = 0
row("plain values", () => titleOf(make({ title: "t", hint: "h" })))
row("a required member computed on each read", () => { const item = make({ title: () => "computed " + ++count }); return titleOf(item) + " " + titleOf(item) })
row("optional members too", () => titleOf(make({ title: () => "T", hint: () => "H", note: () => "N" })))
row("the keys and the order", () => { const item = make({ title: () => "T", note: () => "N" }); return Object.keys(item).join() + " " + JSON.stringify(item) + " " + typeof Object.getOwnPropertyDescriptor(item, "title")?.get })
row("a store to a member without a setter", () => { const item = make({ title: () => "T" }); let threw = "stored"; try { item.title = "x" } catch (e) { threw = (e as Error).name } return threw + " " + item.title })
row("the other members still store", () => { const item = make({ title: () => "T" }); item.size = 2.5; item.on = false; item.tags.push("u"); return titleOf(item) })
row("both kinds in one array", () => [make({ title: "a" }), make({ title: () => "b" }), make({ title: "c" })].map(titleOf).join(" "))
row("a copy holds the value", () => { const copy = { ...make({ title: () => "once " + ++count }) }; return copy.title + " " + copy.title })
row("with a setter", () => { const item = make({ title: "t" }); let kept = "k"; Object.defineProperty(item, "title", { get: () => kept, set: (v: string) => { kept = v + "!" }, enumerable: true, configurable: true }); item.title = "set"; return item.title })
row("made a value again", () => { const item = make({ title: () => "T" }); Object.defineProperty(item, "title", { value: "plain again", writable: true, enumerable: true, configurable: true }); item.title += "."; return titleOf(item) })
let total = 0
for (let i = 0; i < 2000; i++) total += titleOf(make({ title: "n" + i })).length
console.log("objects that stay as they were made: " + total)
