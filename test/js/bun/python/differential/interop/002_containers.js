import m from "./002_containers.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
// dict: items first, then attributes.
print(m.d.a, m.d.b, m.d["a"], m.d.items, typeof m.d.keys, m.d.missing, m.d[3], m.d["3"], m.d[10], m.d.length);
print(Object.keys(m.d).join(), JSON.stringify(m.d));
print("a" in m.d, "zz" in m.d, 3 in m.d, 4 in m.d);
m.d.c = 5; m.d[7] = "seven"; print(m.show(m.d));
print(delete m.d.c, delete m.d[7], delete m.d.nope, m.show(m.d));
print(Object.keys(m.empty).length, JSON.stringify(m.empty), m.empty.length);
for (const k in m.od) print("for-in", k, m.od[k]);
print(JSON.stringify({ ...m.od }), Object.entries(m.od).join("|"));
print(m.dd.x, m.dd.then, m.dd.toJSON, m.show(m.dd.keys()), JSON.stringify(m.dd));
// Sequences.
print(m.t[0], m.t[1], typeof m.t[1], m.t[2], m.t[3], m.t[4], m.t.length, 3 in m.t, 4 in m.t, m.t[-1]);
print(Object.keys(m.t).join(), JSON.stringify(m.t), [...m.t].length);
print(m.r[0], m.r[2], m.r[3], m.r.length, JSON.stringify(m.r), m.r.start, m.r.step);
print(m.b[0], m.b.length, JSON.stringify(m.b), m.ba[2]);
m.ba[0] = 65; print(m.show(m.ba));
try { m.t[0] = 9; } catch (e) { print("caught", e.name, e.message); }
try { m.ba[0] = 300; } catch (e) { print("caught", e.name, e.message); }
print(JSON.stringify(m.s), JSON.stringify(m.fs), m.s.length, m.s[0]);
print(m.seq[1], m.seq[3], m.seq.length, JSON.stringify(m.seq), Object.keys(m.seq).join());
m.seq[1] = 21; delete m.seq[0]; print(m.show(m.seq.data));
// list is Array.
print(Array.isArray(m.lst), m.lst.length, m.lst[0], m.lst[2], JSON.stringify(m.lst), m.lst[1] + 1, m.lst[1] == 2, `${m.lst[1]}`);
m.lst.push(9); print(m.show(m.lst));
print(JSON.stringify(m.nested));
// Instances.
print(Object.keys(m.plain).join(), JSON.stringify(m.plain), Object.keys(m.pt).join(), JSON.stringify(m.pt));
// Subclasses of str, int, float.
print(`${m.mystr}`, m.mystr + "!", m.mystr.length, m.mystr[0], JSON.stringify(m.mystr), m.mystr.upper(), typeof m.mystr);
print(m.myint + 1, m.myint * 2, `${m.myint}`, JSON.stringify(m.myint), m.myint.valueOf(), m.myint == 41, typeof m.myint);
print(m.myfloat + 1, JSON.stringify([m.myfloat]), Math.floor(m.myfloat), m.myfloat.valueOf(), m.myfloat.is_integer());
print(typeof m.big, m.big, m.big + 1n);
print(Object.prototype.toString.call(m.t), Object.prototype.toString.call(m.plain), String(m.t), `${m.d.a}`, m.t.toString(), String(m.s));
print(m.type_name(null), m.type_name(undefined), m.show(null), m.type_name(1), m.type_name(1.5), m.type_name("s"), m.type_name([]), m.type_name(true), m.type_name(10n ** 30n), m.type_name({}), m.type_name(() => 1));
