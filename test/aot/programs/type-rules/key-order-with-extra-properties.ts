// The order of own keys of typed objects when optional fields and extra properties are added in turn.
interface O { a: number; b?: number; c?: string; d?: boolean }
function show(o: object) { return Object.keys(o).join() + " " + JSON.stringify(o) }
const mixed: O = { a: 1, d: true }
const open: any = mixed
open.extra1 = 1; mixed.c = "late"; open.extra2 = 2; mixed.b = 5
console.log(show(mixed))
delete open.extra1; delete open.c; mixed.c = "again"
try { delete open.a; console.log("delete of a required field: no error") } catch (e) { console.log("delete of a required field:", e instanceof TypeError ? "TypeError" : "other " + e) }
open.a = 9
console.log(show(mixed), mixed.a + 1, mixed.c, "c" in mixed)
for (const k in mixed) console.log(k, (mixed as any)[k])
