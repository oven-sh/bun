import m from "./001_attributes.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
print(typeof m, typeof m.a, typeof m.A, typeof m.show, typeof m.a.double);
print(m.number, m.half, m.whole, typeof m.whole, m.text, m.flag, m.nothing);
print(m.a.x, m.a.cls_attr, m.a.double(), m.a.prop, m.a.none, m.a.missing);
print("x" in m.a, "missing" in m.a, "double" in m.a, "none" in m.a);
print(m.a.hasOwnProperty("x"), m.a.hasOwnProperty("missing"));
m.a.x = 4; print(m.a.x, m.a.double(), m.get_x(m.a));
m.a.fresh = "new"; print(m.a.fresh, m.show(m.attrs(m.a)));
print(delete m.a.fresh, m.a.fresh, delete m.a.never_there);
print(m.A.cls_attr, m.A.static(1), m.A.make(3).x, m.a.static(5));
const f = m.a.double; m.a.x = 10; print(f());
try { m.a.boom(); } catch (e) { print("caught", e.name, e.message); }
try { m.a.bad; } catch (e) { print("caught", e.name, e.message); }
try { m.a.prop = 1; } catch (e) { print("caught", e.name, e.message); }
try { m.ro.b = 1; } catch (e) { print("caught", e.name); }
print(m.ro.a, m.ro.b);
print(m.dyn.dyn_hello, m.dyn.other, "dyn_x" in m.dyn, "other" in m.dyn);
(function () { /* sloppy */ }).call();
print(Object.getPrototypeOf(m.a) === Object.getPrototypeOf(m.ro), Object.getPrototypeOf(Object.getPrototypeOf(m.a)) === Object.prototype);
try { Object.setPrototypeOf(m.a, {}); } catch (e) { print(e instanceof TypeError); }
const d = Object.getOwnPropertyDescriptor(m.a, "x");
print(d.value, d.writable, d.enumerable, d.configurable);
print(Object.getOwnPropertyDescriptor(m.a, "missing"));
Object.defineProperty(m.a, "defined", { value: 3 }); print(m.a.defined, m.get_x(m.a));
const sym = Symbol("s"); m.a[sym] = 1; print(m.a[sym], Object.getOwnPropertySymbols(m.a).length, m.show(m.attrs(m.a)));
m.number = 6; print(m.number, pythonImport("001_attributes").number);
print(m.a.constructor === m.A, m.a.constructor.cls_attr);
