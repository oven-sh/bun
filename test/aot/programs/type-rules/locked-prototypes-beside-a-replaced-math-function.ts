// `Object.prototype` is closed entirely: a store of a new name throws. `Array.prototype` only keeps its members: it takes a new name, and every array sees it. The members of `Math` are fixed but for the few that packages replace. `Math.sign` is one of those, a constant only in a program that never writes it: this program replaces it and sees its write.
interface Rec { n: number; o?: number }
function fresh(): Rec { return { n: 1 } }
try { (Object.prototype as any).o = 12; console.log("a property added to Object.prototype: no error") } catch (e) { console.log("a property added to Object.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(fresh().o, delete (Object.prototype as any).o, fresh().o)
try { (Array.prototype as any).o6 = 12; console.log("a property added to Array.prototype: no error") } catch (e) { console.log("a property added to Array.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(([] as any).o6)
// A member that is not fixed can be replaced, and the program sees its write.
try { (Math as any).sign = () => 0; console.log("Math.sign replaced: no error") } catch (e) { console.log("Math.sign replaced:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Math.sign(1.5))
