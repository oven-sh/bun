// What Reflect.* answers for a built-in object: a boolean, never an error.
function answer(f: () => unknown) { try { return String(f()) } catch (e) { return e instanceof TypeError ? "TypeError" : "other error" } }
const f = function () { return 1 }
console.log(answer(() => Reflect.set(Array.prototype, "push", f)), answer(() => Reflect.defineProperty(Array.prototype, "push", { value: f })), answer(() => Reflect.deleteProperty(Array.prototype, "push")), answer(() => Reflect.setPrototypeOf(Array.prototype, null)))
console.log(answer(() => Reflect.set(Date, "now", f)), answer(() => Reflect.defineProperty(Math, "random", { value: f })), answer(() => Reflect.deleteProperty(JSON, "parse")), answer(() => Reflect.set(Array.prototype, "extra", 1)))
console.log([1].push(2), typeof Date.now(), typeof Math.random(), JSON.parse("3"), ("extra" in Array.prototype))
