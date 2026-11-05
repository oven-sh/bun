// Strs that JS made as keys of Python's dicts and sets, and Python's dicts read and written by JS, before and after a dict goes over to
// placing its str keys by hash().
import m from "./017_dict_keys.py";
const print = (...values) => console.log(values.map(String).join(" "));
const literal = ["a", "b", "é", "€", "😀", "x".repeat(70), "", "10"];
// The same texts, made otherwise: cut out of wider ones, ropes, from numbers, from bytes.
const wide = "é€😀ab";
const made = [wide.slice(4, 5), wide.slice(5), wide.slice(0, 1), wide.slice(1, 2), wide.slice(2, 4), "x".repeat(30) + "x".repeat(40), wide.slice(0, 0), String(10)];
const decoded = literal.map(k => new TextDecoder().decode(new TextEncoder().encode(k)));
print(literal.every((k, i) => m.same_hash(k, made[i]) && m.same_hash(k, decoded[i]) && m.same_hash(k, m.own()[i])));
print(m.hashes(literal).every((h, i) => h == m.hashes(made)[i] && h == m.hashes(m.own())[i]), m.hashes([""])[0]);
for (const keys of [literal, made, decoded]) {
    const d = m.fresh();
    for (let stage = 0; stage < 2; stage++) {
        print(stage, keys.map(k => m.get(d, k)).join(), keys.map(k => d[k]).join(), keys.map(k => k in d).join(), m.get(d, "nope"), d.nope, "nope" in d, m.get(d, "A"));
        print(m.switch(d));
    }
    m.put(d, keys[0], "py"); d[keys[1]] = "js"; d.fresh1 = 1; m.put(d, "fresh" + 2, 2);
    print(d.a, d.b, m.get(d, "fresh1"), d.fresh2, m.drop(d, keys[2]), delete d[keys[3]], m.has(d, "é"), "€" in d, d.length, Object.keys(d).length);
    print(m.show(d));
}
// Made of JS's strs from the start.
for (const keys of [literal, made, decoded]) {
    const d = m.as_dict(keys), s = m.as_set(keys);
    print(m.own().map(k => m.get(d, k)).join(), m.own().every(k => m.has(s, k)), m.has(s, "nope"), m.switch(d), m.switch(s), m.own().map(k => d[k]).join(), literal.every(k => m.has(s, k)), s.length);
}
// A dict that JS fills, with names that are properties elsewhere as well.
const d = m.as_dict([]);
const object = {};
for (let i = 0; i < 300; i++) { d["name" + i] = i; object["name" + i] = i; if (i == 150) m.switch(d); }
let good = 0;
for (let i = 0; i < 300; i++) if (d["name" + i] === i && m.get(d, "name" + i) === i && m.get(d, Object.keys(object)[i]) === i) good++;
print(good, d.length, Object.keys(d).length, Object.keys(d)[299], JSON.stringify(d).length == JSON.stringify(object).length);
