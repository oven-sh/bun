// The shape of signal-exit: Object.defineProperty bound to Object, called with the global object and a registered symbol.
const define = Object.defineProperty.bind(Object);
const key = Symbol.for("witness emitter");
const global = globalThis;
class Emitter {
  constructor() {
    if (global[key]) return global[key];
    define(global, key, { value: this, writable: false, enumerable: false, configurable: false });
  }
}
const first = new Emitter();
console.log(new Emitter() === first, typeof process.pid, typeof console.log);
