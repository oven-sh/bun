// Runtime type checks: new properties on array and `Object.prototype`.
const protoAny: any = Array.prototype
try { protoAny.foo = 1; console.log("Array.prototype.foo: no error") } catch (e) { console.log("Array.prototype.foo:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { protoAny["1"] = 1; console.log("Array.prototype['1']: no error") } catch (e) { console.log("Array.prototype['1']:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { protoAny[2] = 1; console.log("Array.prototype[2]: no error") } catch (e) { console.log("Array.prototype[2]:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.isExtensible(protoAny), protoAny.foo, protoAny[1], protoAny[2])
const o: any = Object.prototype
try { o[2] = 1; console.log("Object.prototype[2]: no error") } catch (e) { console.log("Object.prototype[2]:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Objects of the program are not concerned.
const q: any = {}
q[2] = 1
const r: any = []
r[2] = 1
console.log(q[2], r[2], r.length)
