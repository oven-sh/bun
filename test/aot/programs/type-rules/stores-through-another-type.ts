// A callback turns a field into an accessor or changes the prototype of an object while a loop reads it through another type: the loop sees the change.
interface Left { v: number; w: number }
interface Right { v: number; extra?: string }
// The object changes under the loop: an accessor, another prototype.
function loopCall(a: Left, f: (i: number) => void): number { let sum = 0; for (let i = 0; i < 10; i++) { sum += a.v; f(i) } return sum }
let reads = 0
function becomeAccessor(o: object): void { Object.defineProperty(o, "v", { get() { return ++reads * 1000 }, set() {}, configurable: true, enumerable: true }) }
const changing: Left = { v: 1, w: 0 }
try { loopCall(changing, i => { if (i === 3) becomeAccessor(changing) }); console.log("a field becomes an accessor: no error") } catch (e) { console.log("a field becomes an accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(reads, changing.v, JSON.stringify(changing))
function optionalLoop(b: Right, f: (i: number) => void): string { const out: string[] = []; for (let i = 0; i < 6; i++) { out.push(String(b.extra)); f(i) } return out.join() }
const inheriting: Right = { v: 0 }
try { optionalLoop(inheriting, i => { if (i === 1) Object.setPrototypeOf(inheriting, { extra: "proto" }) }); console.log("another prototype: no error") } catch (e) { console.log("another prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(String(inheriting.extra), Object.getPrototypeOf(inheriting) === Object.prototype)
