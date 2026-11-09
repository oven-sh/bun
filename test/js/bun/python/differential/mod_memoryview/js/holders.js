// bun holders.js: a view that JS keeps holds the exporter as one that Python keeps does. Prints "ok", or what is wrong.
import * as py from "./holders_helper.py";

let failures = 0;
const used = [];
function check(name, make, isOld = false) {
  let holder = make();
  if (isOld) Bun.gc(true);
  const held = py.blocked();
  const released = py.released();
  used.push(typeof holder); // A variable that is not read again holds nothing.
  holder = null;
  const after = py.blocked();
  if (held !== true || released !== false || after !== false) {
    failures++;
    console.log(`FAIL ${name}: blocked while held: ${held}, released: ${released}, after: ${after}`);
  }
}
class WithField { #v = py.view(); }
check("variable", () => py.view());
check("array", () => [py.view()]);
check("array of arrays", () => [[1, [py.view()]]]);
check("property", () => ({ v: py.view() }));
check("many properties", () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; o.v = py.view(); return o; });
check("indexed property", () => { const o = {}; o[5] = py.view(); return o; });
check("sparse array", () => { const a = []; a[100000] = py.view(); return a; });
check("symbol property", () => ({ [Symbol("s")]: py.view() }));
check("private field", () => new WithField());
check("closure", () => { const v = py.view(); return () => v; });
check("bound this", () => (function () {}).bind(py.view()));
check("bound argument", () => (function () {}).bind(null, 1, py.view()));
check("Map value", () => new Map([[1, py.view()]]));
check("Map key", () => new Map([[py.view(), 1]]));
check("Set", () => new Set([py.view()]));
check("WeakMap value", () => { const k = {}; return [k, new WeakMap([[k, py.view()]])]; });
check("resolved promise", () => Promise.resolve(py.view()));
check("generator", () => { const g = (function* () { const v = py.view(); yield 1; yield v; })(); g.next(); return g; });
check("spread", () => [...[py.view()]]);
check("frozen copy-on-write literal", () => Object.freeze([1, 2, py.view()]));
check("Error cause", () => new Error("e", { cause: py.view() }));
check("old property", () => ({ v: py.view() }), true);
check("old prototype", () => Object.create({ v: py.view() }), true);
check("instance of ctypes on a prototype", () => Object.create({ v: py.instance() }));
// Not in strict code: a parameter that has lost its name is still an item of `arguments`.
check("parameter hidden by its namesake", () => new Function("a", "a", "(() => a); return arguments;")(py.view(), 1));
check("parameter hidden by a function", () => new Function("a", "b", "function a() {} (() => b); return arguments;")(py.view(), 1));
// What an object inherits from is reached through its structure.
check("prototype", () => Object.create({ v: py.view() }));
check("prototype given later", () => Object.setPrototypeOf({}, { v: py.view() }));
check("prototype of an array", () => Object.setPrototypeOf([], { v: py.view() }));
check("prototype of the prototype", () => Object.create(Object.create({ v: py.view() })));
check("prototype of a function", () => Object.setPrototypeOf(() => {}, { v: py.view() }));
check("instance of a class, method", () => { const v = py.view(); return new (class { get() { return v; } })(); });
{
  // In the hands of a function that is running.
  const inner = v => { const r = py.blocked(); used.push(typeof v); return r; };
  const results = [inner(py.view()), py.blocked()];
  if (results[0] !== true || results[1] !== false) {
    failures++;
    console.log("FAIL argument of a running function: " + results);
  }
}
{
  // On a prototype that no object has just now: the global object has only the structure for the next one.
  const prototype = () => Object.getPrototypeOf("a".matchAll(/a/g));
  prototype().v = py.view();
  const results = [py.blocked(), delete prototype().v, py.blocked()];
  if (results[0] !== true || results[2] !== false) {
    failures++;
    console.log("FAIL prototype that only a structure of the global object refers to: " + results);
  }
}
{
  // What the engine has cached on a structure, and is out of date, holds nothing: the chain of the prototypes of `object`.
  const middle = Object.setPrototypeOf({}, { v: py.view() });
  const object = Object.create(middle);
  for (const key in object) used.push(key);
  object.q = 1;
  const results = [py.blocked(), Object.setPrototypeOf(middle, null) === middle, py.blocked()];
  used.push(typeof object);
  if (results[0] !== true || results[2] !== false) {
    failures++;
    console.log("FAIL prototype that was taken out of the chain: " + results);
  }
}
{
  // In the frame that a call is filling from something like an array, whose last item asks. The frame may be longer than the caller has registers.
  const f = (...all) => [all[0], all.at(-1)];
  const call = list => { const result = f.apply(null, list); return result; };
  const callInTailPosition = list => f.apply(null, list);
  for (const [name, g, length] of [["call", call, 2], ["call with many arguments", call, 300], ["call in tail position", callInTailPosition, 2]]) {
    const results = g({ length, get 0() { return py.view(); }, get [length - 1]() { return py.blocked(); } });
    results[0] = py.released();
    results.push(py.blocked());
    if (results[0] !== false || results[1] !== true || results[2] !== false) {
      failures++;
      console.log(`FAIL argument of a ${name} that is being prepared: ` + results);
    }
  }
}
console.log(failures ? `${failures} failed` : "ok");
