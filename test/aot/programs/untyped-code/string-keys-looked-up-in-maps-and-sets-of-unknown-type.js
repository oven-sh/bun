// Map.prototype.get and has, Set.prototype.has with string keys, on receivers and keys whose types the compiler does not know: the key itself, another string with the same text, text that was never hashed, keys that are not there, chains with deleted entries.
const said = [];
const get = (map, key) => map.get(key), has = (collection, key) => collection.has(key);
const show = (label, ...answers) => said.push(label + ": " + answers.join(" "));
const flat = text => text.split("").join(""), sliced = text => ("<" + text + ">").slice(1, -1), rope = text => text.slice(0, 1) + text.slice(1);
const names = Array.from({ length: 400 }, (_, i) => "name" + i);
for (const n of [0, 1, 3, 4, 5, 16, 17, 64, 400]) {
  const map = new Map(), set = new Set();
  map.set(0, "a number first"); set.add(0);
  for (let i = 0; i < n; i++) { map.set(names[i], i); set.add(names[i]); }
  let same = 0, other = 0, twice = 0, cut = 0, joined = 0, absent = 0, inSet = 0;
  for (let i = 0; i < n; i++) {
    same += get(map, names[i]) === i && has(map, names[i]) ? 1 : 0;
    const fresh = flat(names[i]);
    other += get(map, fresh) === i ? 1 : 0;
    twice += get(map, fresh) === i && has(map, fresh) && has(set, fresh) ? 1 : 0;
    cut += get(map, sliced(names[i])) === i ? 1 : 0;
    joined += get(map, rope(names[i])) === i && has(set, rope(names[i])) ? 1 : 0;
    inSet += has(set, names[i]) ? 1 : 0;
  }
  for (let i = n; i < 400; i++) absent += get(map, names[i]) === undefined && !has(map, names[i]) && !has(set, names[i]) && !has(set, flat(names[i])) ? 1 : 0;
  show("of " + n, same, other, twice, cut, joined, inSet, absent, get(map, 0), has(set, 0), get(map, "0"), has(set, "0"));
}
{
  const map = new Map([[1, "one"]]), set = new Set([1]);
  for (let i = 0; i < 40; i++) { map.set(names[i], i); set.add(names[i]); }
  for (let i = 0; i < 40; i += 3) { map.delete(names[i]); set.delete(names[i]); }
  show("after deletions", names.slice(0, 40).map(name => +has(map, name)).join(""), names.slice(0, 40).map(name => +has(set, flat(name))).join(""), get(map, names[1]), get(map, names[3]));
  for (let i = 0; i < 40; i += 6) { map.set(names[i], "back"); set.add(names[i]); }
  show("some are back", names.slice(0, 40).map(name => +has(map, flat(name))).join(""), names.slice(0, 40).map(name => +has(set, name)).join(""), get(map, names[6]), get(map, names[3]));
  map.clear(); set.clear();
  show("after clear()", has(map, names[1]), get(map, names[1]), has(set, names[1]), map.size, set.size);
  map.set(names[1], "new"); set.add(names[1]);
  show("and filled again", has(map, flat(names[1])), get(map, names[1]), has(set, names[1]), has(map, names[2]));
}
{
  const map = new Map([[{}, 0]]);
  const values = [undefined, null, 0, -0, NaN, "", false, "text", 1.5, 10n, [1], { a: 1 }];
  values.forEach((value, i) => map.set("v" + i, value));
  show("values of every kind", values.map((value, i) => Object.is(get(map, "v" + i), value) && has(map, "v" + i) ? 1 : 0).join(""), get(map, "v12"), has(map, "v12"));
  const texts = ["", " ", "a", "A", "é", "日本", "a\0b", "a\0c", "x".repeat(17), "x".repeat(18), "x".repeat(300), "0", "-0", "1e3", "__proto__", "constructor"];
  const held = new Map([[0, 0]]), kept = new Set([0]);
  texts.forEach((text, i) => { if (i % 2 === 0) { held.set(text, i); kept.add(text); } });
  show("texts of every kind", texts.map(text => +has(held, flat(text))).join(""), texts.map(text => +has(kept, text)).join(""), texts.map(text => String(get(held, sliced(text)))).join());
}
{
  let found = 0;
  const context = new Map([[Symbol.iterator, 0]]);
  for (let i = 0; i < 12; i++) context.set("service/" + names[i], i);
  const wanted = names.slice(0, 24).map(name => "service/" + name).map(flat);
  for (let round = 0; round < 20000; round++) { const key = wanted[round % 24]; const value = get(context, key); if (value === undefined && !has(context, key)) continue; found += value; }
  show("asked many times", found);
}
console.log(said.join("\n"));
