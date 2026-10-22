// The order of own keys of typed objects whose optional fields are added late.
interface Wide { id: number; p?: number; q?: string; r?: boolean }
function keys(o: object): string { return Object.keys(o).join("") }
function show(o: object): string { return keys(o) + " " + JSON.stringify(o) }
const loose: any = { id: 5 } as Wide
const typed: Wide = loose
loose.x1 = 1; typed.q = "q"; loose.x2 = 2; typed.p = 3; loose.x3 = 3; typed.r = true
console.log(show(typed))
delete loose.x2; delete typed.q; typed.q = "again"; loose.x2 = "back"
console.log(show(typed), typed.q, typed.p)
console.log(keys({ ...typed }), Object.entries(typed).map(e => e[0]).join(""), Reflect.ownKeys(typed).join(""))
// A required field is deleted like any other. Stored again, it is the last key.
const cycle: Wide = { id: 6, p: 1, q: "q", r: true }
try { delete (cycle as { id?: number }).id; console.log("delete of a required field: no error") } catch (e) { console.log("delete of a required field:", e instanceof TypeError ? "TypeError" : "other " + e) }
cycle.id = 60
console.log(show(cycle))
