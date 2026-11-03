// bun holders.js: a view that JS keeps holds the exporter as one that Python keeps does. Prints "ok", or what is wrong.
import * as py from "./holders_helper.py";

let failures = 0;
const used = [];
function check(name, make) {
  let holder = make();
  const held = py.blocked();
  used.push(typeof holder); // A variable that is not read again holds nothing.
  holder = null;
  const after = py.blocked();
  if (held !== true || after !== false) {
    failures++;
    console.log(`FAIL ${name}: blocked while held: ${held}, after: ${after}`);
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
{
  // In the hands of a function that is running.
  const inner = v => { const r = py.blocked(); used.push(typeof v); return r; };
  const results = [inner(py.view()), py.blocked()];
  if (results[0] !== true || results[1] !== false) {
    failures++;
    console.log("FAIL argument of a running function: " + results);
  }
}
console.log(failures ? `${failures} failed` : "ok");
