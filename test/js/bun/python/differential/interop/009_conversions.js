import m from "./009_conversions.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
print(String(m.text), `${m.text}`, m.text + "", "" + m.text, m.text.toString(), m.text.toLocaleString(), String(m.only), m.text.valueOf() === m.text);
print(+m.num, +m.num * 2, `${m.num}`, m.num + "", Number(m.num), Math.round(m.num), +m.idx, +m.idx * 2, [10, 20, 30, 40, 50, 60, 70, 80][+m.idx], +m.text, Number.isNaN(+m.only));
print(+m.frac, m.frac * 4, String(m.frac), String(m.cplx), +m.cplx);
try { String(m.bad); } catch (e) { print(e.name, e.message); }
try { `${m.bad}`; } catch (e) { print(e.name, e.message); }
print(m.own.toString(), m.own.valueOf(), String(m.own).startsWith("<009_conversions.OwnToString"));
// Whole floats in a list are objects that behave as Number objects do.
const f = m.floats;
print(f.map(x => typeof x).join(), f.map(x => x + 1).join(), f.map(String).join(), JSON.stringify(f.slice(0, 4)));
print(f[0] == 1, f[0] === 1, f[0] * 2, -f[2], f[0] < 2, f[0] > 2, f[0].valueOf() === 1, Number(f[1]) === 0, Math.max(...f.slice(0, 4)), f[0].is_integer(), f[0].hex());
print(f.slice(0, 4).sort((a, b) => a - b).map(Number).join(), f.slice(0, 4).reduce((a, b) => a + b, 0), Object.prototype.toString.call(f[0]), f[0].constructor.__name__);
print(m.kinds(f).join(), m.kinds(f.map(x => x * 1)).join(), m.kinds([1, 1.5, 2 / 2, 3 / 2, 1e3, 2 ** 53, 2 ** 53 + 2, -0, NaN, Infinity]).join());
print(m.kinds([null, undefined, true, "s", 1n, 2n ** 64n, [], {}, () => 1, Symbol.iterator, new Date(0), /x/, new Map()]).join());
print(m.none_list[0], m.none_list.length, m.same(null, undefined), m.eq(null, undefined), m.same(m.text, m.text), m.same(m.floats, f), m.same("a", "a"), m.eq(1, 1.0));
