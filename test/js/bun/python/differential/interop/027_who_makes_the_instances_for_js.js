// Reflect.construct(T, args, N), and super(...) in a class derived from T, are T.__new__(N, ...): the C++ function of a type is handed no class that
// Python would not hand it.
import m from "./027_who_makes_the_instances_for_js.py";
import python from "bun:python";
const b = python.import("builtins"), datetime = python.import("datetime"), collections = python.import("collections"), os = python.import("os"), time = python.import("time");
const attempt = f => { try { return String(m.tell(f())); } catch (e) { return e.name + ": " + e.message; } };
const row = (label, f) => console.log(label, "->", attempt(f));
const T = { object: b.object, dict: b.dict, tuple: b.tuple, int: b.int, bool: b.bool, str: b.str, date: datetime.date, datetime: datetime.datetime, tzinfo: datetime.tzinfo, timezone: datetime.timezone,
  OrderedDict: collections.OrderedDict, Exception: b.Exception, OSError: b.OSError, KeyError: b.KeyError, terminal_size: os.terminal_size, stat_result: os.stat_result, struct_time: time.struct_time,
  NoneType: b.type(undefined), P: m.P, PN: m.PN, SubDict: m.SubDict, SubDate: m.SubDate };
const args = { date: [2020, 1, 2], datetime: [2020, 1, 2], SubDate: [2020, 1, 2], timezone: [datetime.timedelta(0)], terminal_size: [[1, 2]], stat_result: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], struct_time: [[1, 2, 3, 4, 5, 6, 7, 8, 9]] };

console.log("--- Reflect.construct(T, args, N), where N derives from T. What T.__new__(N, ...) gives in Python is shown where it is something else.");
let others = 0, otherwise = 0;
for (const [tn, t] of Object.entries(T)) for (const [nn, n] of Object.entries(T)) {
  if (t === n) continue;
  const a = args[tn] ?? [], fromJS = attempt(() => Reflect.construct(t, a, n));
  if (!b.issubclass(n, t)) {
    // Then it is `new T(...)`.
    ++others;
    if (fromJS !== attempt(() => new t(...a))) { ++otherwise; console.log(tn, "for", nn, "->", fromJS); }
    continue;
  }
  const fromPython = String(m.new(t, n, ...a));
  console.log(tn, "for", nn, "->", fromJS, fromJS === fromPython ? "" : "| in Python: " + fromPython);
}
console.log("pairs where N does not derive from T:", others, "not as new T(...):", otherwise);

console.log("--- class D extends T");
for (const [tn, t] of Object.entries(T)) {
  const a = args[tn] ?? [];
  let D, E;
  try { D = class D extends t { constructor(...a) { super(...a); } }; E = class E extends D {}; } catch (e) { console.log(tn, "no class:", e.name + ": " + e.message); continue; }
  row(tn + ": new D", () => new D(...a));
  console.log(tn + ": D() in Python ->", String(m.call(D, ...a)));
  console.log(tn + ": T.__new__(D) ->", String(m.new(t, D, ...a)));
  console.log(tn + ": object.__new__(D) ->", String(m.new(b.object, D)));
  row(tn + ": new E", () => new E(...a));
  row(tn + ": construct(T, D)", () => Reflect.construct(t, a, D));
  row(tn + ": construct(T, E)", () => Reflect.construct(t, a, E));
  row(tn + ": construct(D, E)", () => Reflect.construct(D, a, E));
  row(tn + ": construct(E, D)", () => Reflect.construct(E, a, D));
}

console.log("--- over a class of Python that finds the __new__ of one built-in type and is made by that of another");
for (const [name, a] of [["TzDict", []], ["ValueOS", [2, "x"]], ["ObjectsNew", []], ["MixDict", []], ["TzInt", [5]], ["Group", ["m", [b.ValueError()]]]]) {
  const C = m[name];
  class D extends C {}
  class K extends C { constructor(...a) { super(...a); this.q = 1; } }
  class F extends C { f = 1; }
  class KK extends K { constructor(...a) { super(...a); } }
  row(name + ": new C", () => new C(...a));
  row(name + ": new D", () => new D(...a));
  row(name + ": new K", () => new K(...a));
  row(name + ": new F", () => new F(...a));
  row(name + ": new KK", () => new KK(...a));
  console.log(name + ": K() in Python ->", String(m.call(K, ...a)));
  row(name + ": construct(C, K)", () => Reflect.construct(C, a, K));
}

console.log("--- other kinds of new.target");
for (const tn of ["object", "dict", "date", "tuple", "P", "PN", "Exception"]) {
  const t = T[tn], a = args[tn] ?? [], S = b.type("S", b.tuple([t]), b.dict());
  class D extends t {}
  row(tn + ": a proxy of itself", () => Reflect.construct(t, a, new Proxy(t, {})));
  row(tn + ": a class of Python derived from it", () => Reflect.construct(t, a, S));
  row(tn + ": a proxy of that", () => Reflect.construct(t, a, new Proxy(S, {})));
  row(tn + ": a proxy of a class of JS derived from it", () => Reflect.construct(t, a, new Proxy(D, {})));
  row(tn + ": itself, bound", () => Reflect.construct(t, a, t.bind(null)));
  row(tn + ": the derived class, bound", () => Reflect.construct(t, a, S.bind(null)));
  row(tn + ": a function of JS", () => Reflect.construct(t, a, function () {}));
  row(tn + ": a class of JS", () => Reflect.construct(t, a, class {}));
}

console.log("--- __new__ is written and taken away");
{
  class D extends m.P {}
  class K extends m.P { constructor(...a) { super(...a); } }
  const all = label => { row(label + ": new P", () => new m.P(1)); row(label + ": new D", () => new D(1)); row(label + ": new K", () => new K(1)); console.log(label + ": D() in Python ->", String(m.call(D, 1))); console.log(label + ": K() in Python ->", String(m.call(K, 1))); };
  all("before");
  m.setnew(m.P, m.pynew);
  all("P.__new__ = f");
  m.delnew(m.P);
  all("deleted");
  m.setnew(D, m.pynew);
  m.setnew(K, m.pynew);
  all("D.__new__ = K.__new__ = f");
  m.delnew(D);
  m.delnew(K);
  all("deleted");
}

console.log("--- a class of JS beside a built-in type, among the bases of a class of Python");
for (const [fn, F] of Object.entries({ object: b.object, Plain: m.Plain, PlainInit: m.PlainInit, PN: m.PN, tzinfo: datetime.tzinfo })) {
  class K extends F { constructor(...a) { super(...a); } }
  class D extends F {}
  for (const [sn, a] of Object.entries({ dict: [], int: [5], tuple: [[1, 2]], str: ["s"], OSError: [2, "x"], KeyError: ["k"], date: [2020, 1, 2], OrderedDict: [] })) for (const [jn, J] of [["K", K], ["D", D]]) {
    const label = `${jn} extends ${fn}, class C(${jn}, ${sn})`, C = m.make("C", J, T[sn]);
    if (typeof C === "string") { console.log(label, "->", C); continue; }
    console.log(label + ": C() in Python ->", String(m.call(C, ...a)));
    row(label + ": new C", () => new C(...a));
    row(label + ": a class of JS derived from C", () => new (class extends C { constructor(...a) { super(...a); } })(...a));
    const R = m.make("R", T[sn], J);
    if (typeof R !== "string") console.log(`class R(${sn}, ${jn}): R() in Python ->`, String(m.call(R, ...a)));
  }
}

console.log("--- an mro() that leaves out the first base, of the classes of JS too");
for (const [xn, X] of Object.entries({ X: m.X, XE: m.XE, XD: m.XD })) {
  class D extends X {}
  class K extends X { constructor(...a) { super(...a); } }
  class K2 extends K { constructor(...a) { super(...a); } }
  for (const [n, c] of Object.entries({ D, K, K2 })) {
    row(`${n} over ${xn}: new`, () => new c());
    console.log(`${n} over ${xn}: in Python ->`, String(m.call(c)));
  }
  row(`Reflect.construct(${xn}, [], K)`, () => Reflect.construct(X, [], K));
}

console.log("--- the __new__ of another built-in type, written into one that can be written to");
{
  const struct = python.import("struct");
  class D extends struct.error {}
  class K extends struct.error { constructor(...a) { super(...a); } }
  for (const n of ["dict", "KeyError", "OSError", "object", "Exception"]) {
    m.setnew(struct.error, T[n].__new__);
    row(n + ": new error", () => new struct.error(1));
    row(n + ": new D", () => new D(1));
    row(n + ": new K", () => new K(1));
    row(n + ": Reflect.construct(error, [1], D)", () => Reflect.construct(struct.error, [1], D));
    row(n + ": Reflect.construct(error, [1], K)", () => Reflect.construct(struct.error, [1], K));
  }
  m.delnew(struct.error);
  row("deleted: Reflect.construct(error, [1], D)", () => Reflect.construct(struct.error, [1], D));
}

console.log("--- a class of JS beside a class with a __new__ of the program's: that is not passed over in silence");
for (const [fn, F] of Object.entries({ Plain: m.Plain, tzinfo: datetime.tzinfo, ValueError: b.ValueError, object: b.object })) for (const [sn, S] of Object.entries({ DictNew: m.DictNew, OSNew: m.OSNew, MixedNew: m.MixedNew })) {
  class K extends F { constructor(...a) { super(...a); } }
  class D extends F {}
  for (const [jn, J] of [["K extends " + fn, K], ["D extends " + fn, D], [fn, F]]) {
    const C = m.make("C", J, S), before = Number(S.calls ?? 0);
    if (typeof C === "string") { console.log(`class C(${jn}, ${sn}) ->`, C); continue; }
    console.log(`class C(${jn}, ${sn}): C() ->`, String(m.call(C)), "| calls of its __new__:", Number(S.calls ?? 0) - before);
  }
}
{
  // A __new__ of the program's that has run already, and has called that of the class of JS.
  class K extends m.ValueOS { constructor(...a) { super(...a); } }
  class M extends b.object { constructor(...a) { super(...a); } }
  for (const [label, bases] of Object.entries({ "W(K), K extends ValueOS": [K], "W(ValueOS)": [m.ValueOS], "W(M, dict)": [M, b.dict], "W(dict)": [b.dict] })) {
    const W = m.withnew("W", ...bases);
    console.log(label + ", with a __new__ that calls super().__new__(cls) ->", String(m.call(W)));
  }
}

console.log("--- a __new__ that returns what is no object for JS: super(...) does not make that `this`");
for (const [label, value] of m.GIVEN.items()) {
  const P = m.gives(value);
  row(`${label}: new P`, () => new P());
  row(`${label}: nothing of its own`, () => new (class extends P {})());
  row(`${label}: a constructor`, () => new (class extends P { constructor() { super(); } })());
  row(`${label}: a constructor that writes to this`, () => new (class extends P { constructor() { super(); this.k = 1; } })());
  row(`${label}: a field`, () => new (class extends P { f = 1; })());
  row(`${label}: a field and a constructor`, () => new (class extends P { f = 1; constructor() { super(); } })());
  row(`${label}: a computed field`, () => new (class extends P { ["f" + 1] = 1; })());
  row(`${label}: a private field`, () => new (class extends P { #f = 1; })());
  row(`${label}: a private method`, () => new (class extends P { #f() {} })());
  row(`${label}: a class between`, () => { class K extends P { constructor() { super(); } } return new (class extends K { f = 1; })(); });
  row(`${label}: super() in an arrow function`, () => new (class extends P { f = 1; constructor() { (() => super())(); } })());
}
