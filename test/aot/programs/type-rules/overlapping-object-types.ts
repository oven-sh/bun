// Objects of two unrelated types are read through a third type in which all their fields are optional.
type AB = { a: number; b: boolean }
type CD = { c: string; d: number[] }
interface MaybeAll { a?: number; b?: boolean; c?: string; d?: number[]; e?: number }
const ab: AB = { a: 1, b: true }
const cd: CD = { c: "cd", d: [3] }
const none: MaybeAll = {}
const maybes: MaybeAll[] = [ab, cd, none]
for (const m of maybes) { m.e ??= 5; m.c ??= "late"; m.a ??= 0.5 }
try { console.log(maybes.map(m => Object.keys(m).join("")).join()) } catch (e) { console.log("line 10:", e instanceof TypeError ? "TypeError" : "other " + e) }
for (const m of maybes) {
  try { delete m.c; console.log("delete c: no error") } catch (e) { console.log("delete c:", e instanceof TypeError ? "TypeError" : "other " + e) }
  try { delete m.a; console.log("delete a: no error") } catch (e) { console.log("delete a:", e instanceof TypeError ? "TypeError" : "other " + e) }
}
try { console.log(maybes.map(m => Object.keys(m).join("")).join(), ab.a + 1, cd.c.length) } catch (e) { console.log("line 15:", e instanceof TypeError ? "TypeError" : "other " + e) }
