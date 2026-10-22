// A symbol that is made at run time, stored to the global object among other receivers, read back through other names of the same object.
var few = process.argv.length < 100;
var key = Symbol.for("attack." + (few ? "a" : "b"));
var receiver = few ? globalThis : { other: 1 };
receiver[key] = { value: 7 };
console.log(global[Symbol.for("attack.a")].value, key in globalThis, Object.getOwnPropertySymbols(globalThis).includes(key), typeof process.pid, typeof console.log);
console.log(delete receiver[key], key in global, globalThis[key]);
Object.defineProperty(receiver, key, { get: function () { return this === globalThis; }, configurable: true });
console.log(receiver[key]);
