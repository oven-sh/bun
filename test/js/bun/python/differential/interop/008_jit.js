import m from "./008_jit.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
const N = 100000;
function getLoop(o) { let s = 0; for (let i = 0; i < N; ++i) s += o.x; return s; }
function putLoop(o) { for (let i = 0; i < N; ++i) o.x = i; return o.x; }
function missLoop(o) { let s = 0; for (let i = 0; i < N; ++i) if (o.nothing === undefined) ++s; return s; }
function methodLoop(o) { let s = 0; for (let i = 0; i < N; ++i) s += o.add(i & 3); return s; }
function propLoop(o) { let s = 0; for (let i = 0; i < N; ++i) s += o.twice; return s; }
function indexLoop(t) { let s = 0; for (let i = 0; i < N; ++i) s += t[i % 10]; return s; }
function outOfRangeLoop(t) { let s = 0; for (let i = 0; i < N; ++i) if (t[10 + (i & 1)] === undefined) ++s; return s; }
function dictLoop(d) { let s = 0; for (let i = 0; i < N; ++i) s += (i & 1) ? d.a : d["b"]; return s; }
function callLoop(f) { let s = 0; for (let i = 0; i < N; ++i) s = f(s); return s; }
function floatLoop(f) { let s = 0; for (let i = 0; i < N; ++i) s += f(i & 3); return s; }
function newLoop(C) { let s = 0; for (let i = 0; i < N; ++i) s += new C(i & 7).x; return s; }
function instanceLoop(o, C) { let s = 0; for (let i = 0; i < N; ++i) if (o instanceof C) ++s; return s; }
function typeofLoop(o) { let s = 0; for (let i = 0; i < N; ++i) if (typeof o === "object") ++s; return s; }
function typeofFunctionLoop(o) { let s = 0; for (let i = 0; i < N; ++i) if (typeof o === "function") ++s; return s; }
function inLoop(o) { let s = 0; for (let i = 0; i < N; ++i) if ("x" in o) ++s; return s; }
function forOfLoop(it) { let s = 0; for (const x of it) s += x; return s; }
function changingLoop(o) { let s = 0; for (let i = 0; i < N; ++i) s += o.v; return s; }
function polyLoop(os) { let s = 0; for (let i = 0; i < N; ++i) s += os[i % os.length].x; return s; }
function lengthLoop(t) { let s = 0; for (let i = 0; i < N; ++i) s += t.length; return s; }
function truthLoop(o) { let s = 0; for (let i = 0; i < N; ++i) if (o) ++s; return s; }
function keysLoop(o) { let s = 0; for (let i = 0; i < N / 10; ++i) for (const k in o) ++s; return s; }
function identityLoop(f, o) { let s = 0; for (let i = 0; i < N; ++i) if (f(o) === o) ++s; return s; }

const p = new m.P(2), q = new m.Q(3);
print(getLoop(p), getLoop(q), getLoop({ x: 1 }), getLoop(p));
print(putLoop(p), p.get(), putLoop({ x: 0 }), putLoop(q), q.get());
p.x = 2;
print(missLoop(p), methodLoop(p), propLoop(p));
print(indexLoop(m.t), indexLoop(m.lst), indexLoop([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), outOfRangeLoop(m.t), dictLoop(m.d));
print(callLoop(m.inc), callLoop(x => x + 1), callLoop(m.inc), floatLoop(m.fhalf));
print(newLoop(m.P), newLoop(class { constructor(x) { this.x = x; } }), newLoop(m.Q));
print(instanceLoop(p, m.P), instanceLoop(p, m.Q), instanceLoop(q, m.P), instanceLoop({}, m.P), instanceLoop(p, Object), instanceLoop([], Array));
print(typeofLoop(p), typeofLoop(m.P), typeofFunctionLoop(m.P), typeofFunctionLoop(m.inc), typeofFunctionLoop(p.get), typeofFunctionLoop(p));
print(inLoop(p), inLoop(m.d), inLoop({ x: 1 }));
print(forOfLoop(m.rng(N)), forOfLoop(m.gen(N)), forOfLoop(m.t), forOfLoop([1, 2, 3]));
print(changingLoop(new m.Changing()));
print(polyLoop([p, q, { x: 10 }, new m.P(5)]), lengthLoop(m.t), lengthLoop(m.lst), lengthLoop("abc"), truthLoop(p), truthLoop(m.d));
print(keysLoop(p), keysLoop(m.d), identityLoop(m.ident, p), identityLoop(m.ident, m.t));
// The attribute changes under a compiled loop.
function watch(o, n) { let s = 0; for (let i = 0; i < n; ++i) s += o.kind; return s; }
print(watch(p, N)); m.P.kind = 2; print(watch(p, N)); p.kind = 3; print(watch(p, N)); delete p.kind; print(watch(p, N));
// Fewer and more arguments than parameters, from compiled code that knows the callee.
function fewerLoop() { let s = 0; for (let i = 0; i < N; ++i) s += m.dflt(1); return s; }
function exactLoop() { let s = 0; for (let i = 0; i < N; ++i) s += m.dflt(1, 1, 1); return s; }
function varLoop() { let s = 0; for (let i = 0; i < N; ++i) s += m.var(1, 2, 3, 4, 5) + m.var(); return s; }
function kwonlyLoop() { let s = 0; for (let i = 0; i < N; ++i) s += m.kwonly(1); return s; }
function tooManyLoop() { let s = 0; for (let i = 0; i < N / 100; ++i) { try { m.dflt(1, 2, 3, 4); } catch (e) { ++s; } } return s; }
const { dflt } = m;
function constantCalleeLoop() { let s = 0; for (let i = 0; i < N; ++i) s += dflt(i & 1, 1); return s; }
print(fewerLoop(), exactLoop(), varLoop(), kwonlyLoop(), tooManyLoop(), constantCalleeLoop());
