// The operators of JS in optimized code: sites that see only objects of JS, then objects of Python, or the other way round, or both.
import m from "./015_operators_jit.py";
const print = (...values) => console.log(values.map(String).join(" "));
const HOT = 100000, WARM = 4000;
class J { constructor(x) { this.x = x; } valueOf() { return this.x; } }
const range = Array.from({ length: 8 }, (_, i) => i);
const js = range.map(i => new J(i % 4)), js2 = range.map(i => (i & 1 ? js[i] : new J(i % 3)));
const kinds = range.map(i => [{}, [], () => 0, new Map(), new Error("e"), new J(i), new Date(0), /r/][i]);
const kinds2 = range.map(i => (i & 1 ? kinds[i] : {}));
const arrays = range.map(i => [i]), arrays2 = range.map(i => (i & 1 ? arrays[i] : [i]));
const functions = range.map(i => () => i), functions2 = range.map(i => (i & 1 ? functions[i] : () => i));
const orNull = range.map(i => (i % 3 === 0 ? null : i % 3 === 1 ? undefined : js[i]));
const vs = [...m.vs], ws = [...m.ws], plains = [...m.plains], tuples = [...m.tuples], tuples2 = [...m.tuples2];
const vsOrNull = range.map(i => (i % 3 === 0 ? null : i % 3 === 1 ? undefined : vs[i]));
const both = range.map(i => (i & 1 ? vs[i] : js[i])), both2 = range.map(i => (i & 2 ? ws[i] : js2[i]));
// Each site is in a function of its own, so that it has seen nothing but what it is given here.
const site = body => (0, eval)(`(function () {
  const KJ = globalThis.KJ, KV = globalThis.KV;
  function eq(a, b) { return a == b; }
  function add(a, b) { return a + b; }
  return function (xs, ys, n) { let s = 0; for (let i = 0; i < n; ++i) { const a = xs[i & 7], b = ys[(i + (i >> 3)) & 7]; ${body} } return s; };
})()`);
const num = r => (typeof r === "number" ? r : typeof r === "object" && r !== null ? 100000 + r.x : -1);
globalThis.num = num;
globalThis.KJ = js[1];
globalThis.KV = new m.V(1);

const bodies = {
  "== branch": "if (a == b) ++s;",
  "== value": "const r = a == b; s += r;",
  "!= branch": "if (a != b) ++s;",
  "!= value": "const r = a != b; s += r;",
  "== unused": "a == b; ++s;",
  "=== branch": "if (a === b) ++s;",
  "a == a": "if (a == a) ++s;",
  "<": "if (a < b) ++s;",
  "<=": "const r = a <= b; s += r;",
  ">": "if (a > b) ++s;",
  ">=": "const r = a >= b; s += r;",
  "+": "const r = a + b; s += num(r);",
  "-": "const r = a - b; s += num(r);",
  "*": "const r = a * b; s += num(r);",
  "* 2": "const r = a * 2; s += typeof r === 'number' ? r : 100000 + r.x;",
  "2 *": "const r = 2 * a; s += typeof r === 'number' ? r : 100000 + r.x;",
  "- 1": "const r = a - 1; s += typeof r === 'number' ? r : 100000 + r.x;",
  "| 0": "const r = a | 0; s += typeof r === 'number' ? r : 100000 + r.x;",
  "-a": "const r = -a; s += typeof r === 'number' ? r : 100000 + r.x;",
  "~a": "const r = ~a; s += typeof r === 'number' ? r : 100000 + r.x;",
  "++": "let c = a; ++c; s += typeof c === 'number' ? c : 100000 + c.x;",
  "chain": "const r = a + b + 1; s += num(r);",
  "inlined ==": "if (eq(a, b)) ++s;",
  "inlined +": "s += num(add(a, b));",
  "== const J": "if (a == KJ) ++s; if (KJ == b) ++s;",
  "== const V": "if (a == KV) ++s; if (KV == b) ++s;",
  "+ const V": "s += num(a + KV);",
};
const orders = {
  "js": [[js, js2, HOT]],
  "js py js": [[js, js2, HOT], [vs, ws, WARM], [js, js2, HOT]],
  "py js py": [[vs, ws, WARM], [js, js2, HOT], [vs, ws, WARM]],
  "both": [[both, both2, WARM], [both2, both, WARM]],
  "js both": [[js, js2, HOT], [both, both2, WARM]],
  "js, one py": [[js, js2, HOT], [js, ws, WARM], [vs, js2, WARM]],
};
for (const [name, body] of Object.entries(bodies)) {
  const results = [];
  for (const [order, phases] of Object.entries(orders)) {
    const f = site(body);
    m.calls();
    // With a Python object for a constant, every turn of the loop is a call of Python code.
    const turns = n => (name.endsWith("const V") ? Math.min(n, 5 * WARM) : n);
    results.push(order + ": " + phases.map(([xs, ys, n]) => f(xs, ys, turns(n))).join(",") + " (" + m.calls() + ")");
  }
  print(name.padEnd(10), results.join("; "));
}
// Equality alone: other kinds of objects, null and undefined among them.
for (const name of ["== branch", "== value", "!= branch", "== unused"]) {
  const results = [];
  for (const phases of [
    [[kinds, kinds2, HOT], [tuples, tuples2, WARM], [kinds, kinds2, HOT]],
    [[js, orNull, HOT], [vs, vsOrNull, WARM], [orNull, js, HOT], [vsOrNull, ws, WARM]],
    [[orNull, js, HOT], [js, vsOrNull, WARM], [vsOrNull, js, WARM]],
    [[js, js2, HOT], [plains, plains, WARM], [plains, vs, WARM]],
    [[kinds, kinds2, HOT], [m.floats, m.floats2, WARM], [tuples, kinds, WARM]],
    [[tuples, tuples2, WARM], [kinds, kinds2, HOT]],
    [[js, js2, HOT], [js, range, WARM], [vs, range, WARM], [vs, ["a", "b", "c", "d", "e", "f", "g", "h"], WARM]],
    [[arrays, arrays2, HOT], [tuples, tuples2, WARM], [js, js2, HOT], [arrays, arrays2, HOT]],
    [[functions, functions2, HOT], [vs, ws, WARM], [arrays, arrays2, HOT], [functions, functions2, HOT]],
    [[arrays, arrays2, HOT], [m.lists, m.lists2, WARM], [m.lists, m.lists, WARM], [m.functions, m.functions, WARM], [m.functions, vs, WARM]],
  ]) {
    const f = site(bodies[name]);
    m.calls();
    results.push(phases.map(([xs, ys, n]) => f(xs, ys, n)).join(",") + " (" + m.calls() + ")");
  }
  print(name.padEnd(10), results.join("; "));
}
// A value and itself: the class is asked, and a NaN of Python's says no.
for (const body of ["if (a == a) ++s;", "const r = a == a; s += r;", "if (a != a) ++s;", "if (eq(a, a)) ++s;", "const c = a; if (c == a) ++s;"]) {
  const results = [];
  for (const phases of [
    [[js, js, HOT], [m.nans, m.nans, WARM], [js, js, HOT]],
    [[m.nans, m.nans, WARM], [js, js, HOT], [m.nans, m.nans, WARM]],
    [[kinds, kinds, HOT], [m.nans, m.nans, WARM], [vs, vs, WARM]],
    [[arrays, arrays, HOT], [m.nans, m.nans, WARM]],
    [[orNull, orNull, HOT], [m.nans, m.nans, WARM]],
    [[range, range, HOT], [m.nans, m.nans, WARM]],
  ]) {
    const f = site(body);
    m.calls();
    results.push(phases.map(([xs, ys, n]) => f(xs, ys, n)).join(",") + " (" + m.calls() + ")");
  }
  print("itself".padEnd(10), results.join("; "));
}
// What compares by identity goes on doing so.
{
  const v = vs[1], same = new m.V(1);
  const f = site("if (xs.includes(ys[0])) ++s; if (xs.indexOf(ys[0]) >= 0) ++s; if (Object.is(a, ys[0])) ++s; switch (a) { case ys[0]: ++s; }");
  print("identity", f(js, [js[1]], HOT), f(vs, [v], WARM), f(vs, [same], WARM), new Set([v, same, v]).size, new Map([[v, 1], [same, 2]]).size, m.calls());
}
