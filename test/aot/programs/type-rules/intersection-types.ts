// The second half of an intersection type is added to an object after its creation, by `Object.assign`.
type HasId = { id: number }
type HasLabel = { label: string; note?: string }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function idOf(h: HasId): number { return h.id }
// A cast from any lets the object through as it is, with the property that was added.
const cast: HasLabel = { label: "cast" }
const assignLoosely: (target: object, source: object) => any = Object.assign
try { const grown = assignLoosely(cast, { id: 7 }) as HasLabel & HasId; console.log(grown.id, idOf(grown), grown.label, show(cast), (grown as object) === cast); console.log("cast from any: no error") } catch (e) { console.log("cast from any:", e instanceof TypeError ? "TypeError" : "other " + e) }
function labelOf(h: HasLabel): string { return h.label }
class Base { base = 1; hello() { return "base " + this.base } }
try { const mixed: Base & HasLabel = Object.assign(new Base(), { label: "mixed" }); console.log(labelOf(mixed)); console.log("an instance with the other half beside it, seen as that half: no error") } catch (e) { console.log("an instance with the other half beside it, seen as that half:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const mixed = assignLoosely(new Base(), { label: "mixed" }) as Base & HasLabel; console.log(labelOf(mixed)); console.log("the same, cast from any: no error") } catch (e) { console.log("the same, cast from any:", e instanceof TypeError ? "TypeError" : "other " + e) }
