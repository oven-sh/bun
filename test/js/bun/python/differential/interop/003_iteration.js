import m from "./003_iteration.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
let out = [];
for (const x of m.gen(3)) out.push(x);
print(out.join(), m.log.join());
print([...m.t].join(), [...m.d].join(), [...m.d.items()].map(String).join(), [...m.d.values()].join(), Array.from(m.t, x => x * 2).join());
print([...m.floats()].map(x => typeof x + x).join());
print([...new m.Countdown(3)].join(), [...new m.OldStyle()].join(), [...new m.OwnNext()].join());
const [a, b, ...rest] = m.gen(5); print(a, b, rest.join());
print(Math.max(...m.t), new Set(m.t).size, new Map(m.d.items()).get("b"));
// Leaving a loop early closes the generator.
m.log.length = 0;
for (const x of m.gen(10)) { if (x == 1) break; }
print(m.log.join());
const c = new m.Closable(); for (const x of c) break; print(c.closed);
// The protocol by hand.
m.log.length = 0;
const g = m.gen(2);
print(typeof g.next, typeof g.return, typeof g[Symbol.iterator], typeof g.send, typeof g.then);
print(JSON.stringify(g.next()), JSON.stringify(g.next("hi")), JSON.stringify(g.next()), JSON.stringify(g.next()), String(m.log));
const g2 = m.gen(5); g2.next(); print(JSON.stringify(g2.return(7)), JSON.stringify(g2.next()));
const it = m.t[Symbol.iterator]();
print(typeof it.next, it[Symbol.iterator]() === it, JSON.stringify(it.next()), it.toString(), Object.keys(it).length);
print(it.map(x => x + 1).toArray().join());
const w = m.catcher()[Symbol.iterator](); w.next();
print(JSON.stringify(w.throw(new (pythonImport("builtins").ValueError)("v"))));
const w2 = m.catcher()[Symbol.iterator](); w2.next();
print(JSON.stringify(w2.throw(new Error("from js"))));
// What cannot be iterated over says so.
print(new m.NotIterable()[Symbol.iterator], new m.Blocked()[Symbol.iterator], new m.NotIterable().next, m.t.next);
try { for (const x of new m.NotIterable()); } catch (e) { print(e instanceof TypeError, e.constructor === TypeError); }
try { for (const x of new m.Failing()); } catch (e) { print(e.name, e.message); }
print(new m.OwnNext().next);
// JS iterables in Python.
print(m.total([1, 2, 3]), m.total(new Set([4, 5])), String(m.as_list("ab")), String(m.as_list(function* () { yield 1; yield 2; }())), String(m.as_list(new Map([[1, 2]]))));
print([...m.s].length, m.s.length);
