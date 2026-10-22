// Typed functions are called through `any` with an argument missing, and a method is called with a `this` that is not an instance of its class: undefined passes every written type and `this` of a method is not tested, so nothing throws.
class K { v = 1; constructor(public w = 2) {} m(a?: number, b?: number) { return [this?.v, a, b].join() } static s(x: number) { return x + 1 } }
function usesThis(this: unknown, a: number) { return typeof this + a }
function withProps(a: number) { return a * 2 }
const table: any[] = [usesThis, withProps, K.s], names = ["usesThis()", "withProps()", "K.s()"]
for (let i = 0; i < table.length; i++) {
  const f = table[i]
  try { f(); console.log(names[i] + ": no error") } catch (e) { console.log(names[i] + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const holder: any = { f: usesThis, g: new K().m, v: 9 }
try { holder.g(1); console.log("another this: no error") } catch (e) { console.log("another this:", e instanceof TypeError ? "TypeError" : "other " + e) }
