// CommonJS, so sloppy mode.
const m = require("./011_edges.py");
const print = (...values) => console.log(values.map(String).join(" "));
// A failed assignment is silent in sloppy mode, as for a read-only property.
m.frozen.x = 1; print(m.frozen.x); m.t[0] = 9; print(m.t[0]); m.t.foo = 1; print(m.t.foo);
try { delete m.t[0]; } catch (e) { print(e.name, e.message); }
// Array-likes.
print(Array.from(m.t).join(), Array.prototype.slice.call(m.t, 1).join(), Array.prototype.map.call(m.t, x => x * 2).join(), Array.prototype.indexOf.call(m.t, 2), Array.isArray(m.t));
print(Object.keys(m.d).join(), Object.getOwnPropertyNames(m.d).slice(0, 4).join());
// A subclass of list.
const l = m.ml;
print(Array.isArray(l), l.length, l.join(), l.total(), l.label, l.note, typeof l.append, l.sort(), l.map(x => x + 1).join(), String(m.is_list(l)));
l.push(4); l.extra = "e"; print(l.total(), m.show(l), m.attrs(l).join(), Object.keys(l).join(), JSON.stringify(l), delete l.extra, l.extra, m.attrs(l).join());
l.length = 1; print(m.show(l), l[0], l[1], "note" in l, "total" in l, "nothing" in l);
for (const x of l) print("item", x);
// Getters run each time.
print(m.getter.p, m.getter.p, m.getter.p);
try { m.weird.length; } catch (e) { print(e.name, e.message); }
// Freezing and the like do no harm.
Object.freeze(m.obj); m.obj.a = 2; print(m.obj.a, Object.isFrozen(m.obj));
Object.preventExtensions(m.obj); m.obj.b = 3; print(m.obj.b);
// Callable objects.
print(typeof m.callable_obj, m.callable_obj(1, 2), [1, 2].map(m.callable_obj).join(), m.callable_obj.call === undefined);
{ class J extends m.Obj { } print(new J() instanceof m.Obj); }
// Symbols, and what the VM itself asks.
print(m.obj[Symbol.toStringTag], m.obj[Symbol.iterator], m.obj[Symbol.toPrimitive].name, Symbol.toPrimitive in m.obj, Object.getOwnPropertySymbols(m.obj).length);
try { null.x; } catch (e) { print(e instanceof TypeError); }
try { m.obj.nope(); } catch (e) { print(e instanceof TypeError, e.message); }
try { m.obj.a(); } catch (e) { print(e instanceof TypeError, e.message); }
print(JSON.stringify(m).length > 2, JSON.stringify({ o: m.obj, t: m.t, f: m.show, n: null }));
