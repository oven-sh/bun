import m from "./004_classes.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
const b = pythonImport("builtins");
const o = new m.Base(1);
print(o.describe(), String(o), typeof o, o.a, o.b, o.rest.length, m.Base.count);
print(m.Base(5, 6, 7, 8).describe(), new m.Derived("x", "y").describe(), m.Base.count);
print(o instanceof m.Base, o instanceof m.Derived, new m.Derived(1) instanceof m.Base, o instanceof m.Other, o instanceof Object, o instanceof Function);
print(1 instanceof b.int, 1.5 instanceof b.int, 1.5 instanceof b.float, "s" instanceof b.str, [] instanceof b.list, true instanceof b.int, undefined instanceof b.object, ({}) instanceof b.dict);
print(42 instanceof m.Magic, 41 instanceof m.Magic, new m.Magic() instanceof m.Magic);
print(m.is_base(o), m.type_of(o) === m.Base, o.constructor === m.Base, m.type_of(m.Base) === b.type, o.__class__ === m.Base);
print(m.Base.kind, m.Derived.kind, new m.Derived(0).kind, m.Derived.__name__, m.Derived.__mro__.length, m.Derived.__bases__[0] === m.Base);
m.Base.kind = "changed"; print(o.kind, m.Base.kind, m.Derived.kind);
print(typeof m.Base, typeof o, typeof new m.Other(), typeof m.func, typeof b.len, typeof o.describe, typeof "".constructor);
print(o(3).join ? "array" : String(o(3)));
try { new m.Base(); } catch (e) { print(e.name + ": " + e.message); }
try { new m.Abstract(); } catch (e) { print(e.name + ": " + e.message); }
try { new (new m.Other())(); } catch (e) { print(e instanceof TypeError); }
try { new m.func(1, 2); } catch (e) { print(e instanceof TypeError); }
try { 1 instanceof o; } catch (e) { print(e instanceof TypeError); }
print(new m.WithNew(0), new m.WithNew(3).v);
print(m.Color.RED.name, m.Color.RED.value, m.Color.GREEN === m.Color.GREEN, m.Color(2) === m.Color.GREEN, [...m.Color].length, m.Color.RED instanceof m.Color, String(m.Color.RED));
print(m.func(1, 2), m.func(1, 2, 4), m.func.name, m.func.length, m.func.__name__, m.func.__doc__, m.func.tag, m.func.missing, m.lam.name);
m.func.other = 1; print(m.func.other, m.func.__dict__.other, Object.keys(m.func).join());
print(m.func.call(null, 1, 1), m.func.apply(undefined, [1, 1, 1]), m.func.bind(null, 10)(1));
print(String(m.Base), `${m.Other}`, String(m.func).replace(/0x[0-9a-f]+/, "ADDR"), String(b.len), m.Base.name, b.len.name, b.int.name);
print(Object.keys(m.Other).join(), Object.keys(m.Base).join());
const C = m.make_class("Made"); print(new C(1).extra, new C(1) instanceof m.Base, C.__name__);
print(b.len([1, 2]), b.len("abc"), b.str(12), b.int("12") + 1, b.float("2") + 1, typeof b.float("2"), b.abs(-2.0), b.max(1, 5, 3), b.sorted([3, 1, 2]).join(), b.isinstance(o, m.Base));
print(String(b.dict([["a", 1]])), String(b.tuple([1, 2])), String(b.set([1])), String(new b.list("ab")));
