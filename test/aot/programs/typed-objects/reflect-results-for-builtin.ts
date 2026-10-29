// What Reflect.* answers for a built-in object is a boolean, never an error: false for a member of Array.prototype and for its prototype, which are fixed, and true as in plain Bun for a new name on Array.prototype and for Date.now, Math.random and JSON.parse, which the program may write.
function answer(f: () => unknown) { try { return String(f()) } catch (e) { return e instanceof TypeError ? "TypeError" : "other error" } }
const f = function () { return 1 }
console.log(answer(() => Reflect.set(Array.prototype, "push", f)), answer(() => Reflect.defineProperty(Array.prototype, "push", { value: f })), answer(() => Reflect.deleteProperty(Array.prototype, "push")), answer(() => Reflect.setPrototypeOf(Array.prototype, null)))
console.log(answer(() => Reflect.set(Date, "now", f)), answer(() => Reflect.defineProperty(Math, "random", { value: f })), answer(() => Reflect.deleteProperty(JSON, "parse")), answer(() => Reflect.set(Array.prototype, "extra", 1)))
console.log([1].push(2), Date.now === f, Math.random === f, "parse" in JSON, "extra" in Array.prototype)
