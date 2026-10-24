// `__proto__ =` on a typed object, optional fields named like members of `Object.prototype`, and a field that is inherited behave as in plain JavaScript.
interface Base1 { inherited: string }
const base1: Base1 = { inherited: "yes" }
const target1: { own: number } = { own: 3 }
try { (target1 as any).__proto__ = base1; console.log("__proto__ = an object: no error") } catch (e) { console.log("__proto__ = an object:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.keys(target1).join(), (target1 as any).inherited, Object.getPrototypeOf(target1) === Object.prototype, target1.own)
try { (target1 as any).__proto__ = 5; console.log("__proto__ = 5: no error") } catch (e) { console.log("__proto__ = 5:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.getPrototypeOf(target1) === Object.prototype, Object.keys(target1).join())
// An optional field that is absent, under a name that Object.prototype has, is looked for on the prototype chain, by typed code
// as by code that has been handed the object as `any`.
function hide(x: unknown): any { return x }
interface Shadow { hasOwnProperty: number; valueOf?: () => unknown; toString?: () => string }
const shadow: Shadow = { hasOwnProperty: 1 }
console.log(typeof shadow.valueOf, typeof shadow.toString, typeof (shadow as any).valueOf, typeof hide(shadow).valueOf, typeof hide(shadow).toString)
shadow.valueOf = () => 42
console.log(typeof shadow.valueOf, +shadow + 1)
delete shadow.valueOf
console.log(typeof shadow.valueOf, shadow.valueOf === Object.prototype.valueOf, hide(shadow).valueOf === Object.prototype.valueOf)
// A field that the object inherits is read through the declared type.
function depthOf(v: { depth: number }): number { return v.depth }
try { console.log("inherited depth: no error", depthOf(Object.create({ depth: 8 }))) } catch (e) { console.log("inherited depth:", e instanceof TypeError ? "TypeError" : "other " + e) }
