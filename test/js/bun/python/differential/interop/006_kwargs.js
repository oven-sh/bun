import m from "./006_kwargs.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
const b = pythonImport("builtins");
const py = python;
const { kwargs } = py;
print(Object.keys(py).join(), typeof kwargs);
print(m.f(1), m.f(1, kwargs({ b: 5 })), m.f(1, kwargs({ c: 9, z: 1, y: 2 })), m.f(1, 2, 3, 4, kwargs({ c: 0 })), m.f(kwargs({ a: "A" })), m.f(1, kwargs({})));
print(String(m.simple(kwargs({ b: 1, a: 2 }))), m.only_kw(kwargs({ x: 1 })), m.only_kw(kwargs({ x: 1, y: 10 })), m.no_args(kwargs({})));
for (const bad of [() => m.f(1, kwargs({ a: 2 })), () => m.simple(1, kwargs({ z: 2 })), () => m.only_kw(1), () => m.no_args(kwargs({ q: 1 })), () => m.simple(1), () => m.simple(1, 2, 3)]) {
    try { bad(); } catch (e) { print(e.name + ": " + e.message); }
}
const c = new m.C(1, kwargs({ name: "given" })); print(c.a, c.name, m.C(2, kwargs({ name: "called" })).name);
print(String(c.method(5, kwargs({ q: 6 }))), String(c.method(kwargs({ p: 1 }))), c(1, kwargs({ k: 2 })), m.C.cm(kwargs({ v: 3 })), m.C.sm(kwargs({ v: 4 })), c.cm(kwargs({ v: 5 })));
// Natives.
print(b.sorted([1, 3, 2], kwargs({ reverse: true })).join(), b.int("ff", kwargs({ base: 16 })), String(b.dict(kwargs({ a: 1, b: 2 }))), b.max([1, -5], kwargs({ key: b.abs })), "a-b".split ? b.str.split("a-b", kwargs({ sep: "-" })).join("+") : "");
try { b.len([1], kwargs({ x: 1 })); } catch (e) { print(e.name + ": " + e.message); }
// Only the last argument counts, and only what kwargs() made.
print(m.f({ b: 5 }).replace(/<.*>/, "OBJ"), JSON.stringify(m.simple(kwargs({ a: 1 }), 0)[0]));
try { m.ident(kwargs({ a: 1 }), 2); } catch (e) { print(e.name + ": " + e.message); }
print(m.f.call(kwargs({ b: 1 }), 7), m.f.apply(null, [1, kwargs({ b: 8 })]), m.f.bind(null, 1)(kwargs({ c: 4 })));
// From a dict, and values of all kinds.
print(m.f(1, kwargs(b.dict([["c", 1.5], ["d", null]]))), m.f(1, kwargs({ c: py.float(2) })), m.f(py.float(3)), m.f(3));
try { kwargs(1); } catch (e) { print(e instanceof TypeError, e.message); }
print(typeof py.float(2), py.float(2) + 1, py.float(2.5), m.type_name(py.float(2)), m.type_name(2), py.import("006_kwargs") === m);
// Hot.
let total = 0; for (let i = 0; i < 20000; ++i) total += m.only_kw(kwargs({ x: i, y: 1 })); print(total);
