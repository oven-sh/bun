// `Object.prototype` is locked and not extensible: stores throw, and the `Reflect` functions return false.
const op: any = Object.prototype
try { op.polluted = 1; console.log("a property added to Object.prototype: no error") } catch (e) { console.log("a property added to Object.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Reflect.set(op, "polluted2", 1), Reflect.defineProperty(op, "polluted3", { value: 1 }))
console.log(Object.isExtensible(op), "[" + Object.keys(op).join() + "]")
const o = { z: 1 }
try { op.polluted4 = 1; console.log("the same once an object has been made: no error") } catch (e) { console.log("the same once an object has been made:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.isExtensible(op), "[" + Object.keys(op).join() + "]", o.z, (o as any).polluted, (o as any).polluted4)
