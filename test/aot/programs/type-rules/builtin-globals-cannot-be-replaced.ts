// The prototypes of built-in classes are immutable and non-extensible, and built-in globals cannot be replaced.
interface Rec { n: number; o?: number }
function fresh(): Rec { return { n: 1 } }
try { (Object.prototype as any).o = 12; console.log("a property added to Object.prototype: no error") } catch (e) { console.log("a property added to Object.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(fresh().o, delete (Object.prototype as any).o, fresh().o)
try { (Array.prototype as any).o6 = 12; console.log("a property added to Array.prototype: no error") } catch (e) { console.log("a property added to Array.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(([] as any).o6)
// What a built-in name stands for cannot be replaced.
try { (Math as any).ceil = () => 0; console.log("Math.ceil replaced: no error") } catch (e) { console.log("Math.ceil replaced:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Math.ceil(1.5))
