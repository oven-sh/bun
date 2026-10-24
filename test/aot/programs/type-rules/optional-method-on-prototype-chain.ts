// An optional method such as `toString?` that is absent on the object is found on `Object.prototype`.
interface Printable { id: number; toString?: () => string }
const plain: Printable = { id: 1 }
console.log(typeof plain.toString, plain.toString === Object.prototype.toString, plain.toString?.())
try { console.log(plain.toString!()); console.log("the absent field called: no error") } catch (e) { console.log("the absent field called:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Generic code asks the chain.
function untyped(o: any): string { return typeof o.toString }
console.log(untyped(plain), String(plain), `${plain}`)
// Present, it is the field.
plain.toString = () => "own"
console.log(typeof plain.toString, plain.toString(), String(plain))
