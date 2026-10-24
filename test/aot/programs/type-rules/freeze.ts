// Typed objects that are frozen, sealed or made non-extensible, and `delete` on them.
const closed = Object.preventExtensions({ k: 1 })
closed.k = 5
try { delete (closed as any).k; console.log("delete of a required field: no error") } catch (e) { console.log("delete of a required field:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(closed.k, Object.isExtensible(closed), JSON.stringify(closed))
