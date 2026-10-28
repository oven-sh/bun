// `JSON.stringify` on typed objects, on objects that inherit a `toJSON`, and after fields were deleted.
interface Leaf { v: number; note?: string }
interface Doc { title: string; count: number; ok: boolean; leaf: Leaf; leaves: Leaf[]; maybe?: Leaf | null }
// Any object passes for `Leaf`, as it is. This one has another prototype and no `v`, own or inherited.
try { const heir: Leaf = Object.create({ toJSON() { return "inherited" } }); console.log("over a prototype: no error", JSON.stringify(heir)) } catch (e) { console.log("over a prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
// A replacer deletes a required field of the object that is being serialized, stores to another and adds an optional one: every change succeeds, and JSON.stringify goes on as in plain Bun.
const shifting: Doc = { title: "s", count: 1, ok: false, leaf: { v: 1 }, leaves: [] }
try { console.log("delete of a required field in a replacer: no error", JSON.stringify(shifting, (key, value) => { if (key === "title") { shifting.count = 50; delete (shifting as Partial<Doc>).ok; shifting.maybe = { v: 9 } } return value })) } catch (e) { console.log("delete of a required field in a replacer:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(shifting), Object.keys(shifting).join())
// A field is made a getter, another one no longer enumerable: both definitions succeed.
const variant: Leaf = { v: 1, note: "n" }
try { Object.defineProperty(variant, "v", { get() { return 42 }, enumerable: true, configurable: true }); console.log("getter: no error") } catch (e) { console.log("getter:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(variant, "note", { enumerable: false }); console.log("not enumerable: no error") } catch (e) { console.log("not enumerable:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(variant), variant.v, variant.note)
