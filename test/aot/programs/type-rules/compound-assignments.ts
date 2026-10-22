// The right-hand side of a compound assignment turns the target field into an accessor: the old value was read before that, and the sum goes to the new setter.
interface Acc { n: number; s: string }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
const g3: Acc = { n: 1, s: "s" }
let setterGot = -1
try { g3.n += (Object.defineProperty(g3, "n", { get() { return 1000 }, set(v: number) { setterGot = v }, enumerable: true, configurable: true }), 1); console.log("field made an accessor by the right side: no error") } catch (e) { console.log("field made an accessor by the right side:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(g3.n, setterGot, show(g3))
