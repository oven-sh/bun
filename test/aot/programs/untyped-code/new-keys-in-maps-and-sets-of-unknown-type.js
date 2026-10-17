// Map.prototype.set and Set.prototype.add with keys that are not there yet, on receivers and keys whose types the compiler does not know: order, size, growth, deleted entries, walks that are under way, copies.
const said = [];
const text = value => typeof value === "object" && value !== null ? "{" + Object.values(value).join(",") + "}" : typeof value === "symbol" ? value.description : Object.is(value, -0) ? "-0" : String(value);
const put = (map, key, value) => map.set(key, value), add = (set, key) => set.add(key);
const list = map => [...map].map(([key, value]) => text(key) + "=" + text(value)).join(" "), members = set => [...set].map(text).join(" ");
const show = (label, result) => said.push(label + ": " + result);
const objects = Array.from({ length: 300 }, (_, i) => ({ i }));
const kinds = { strings: i => "k" + i, longer: i => "a key that is a good deal longer than sixteen characters " + i, numbers: i => i * 7, negative: i => -i - 1, halves: i => i + 0.5, objects: i => objects[i], symbols: i => Symbol.for("s" + i), big: i => BigInt(i) << 70n, mixed: i => [i, "k" + i, objects[i], i + 0.5, Symbol.for("s" + i)][i % 5] };

for (const [kind, key] of Object.entries(kinds)) {
  for (const n of [1, 3, 4, 5, 15, 16, 17, 63, 64, 65, 300]) {
    const map = new Map(), set = new Set();
    for (let i = 0; i < n; i++) { if (put(map, key(i), i) !== map) show(kind, "set() did not return the map"); if (add(set, key(i)) !== set) show(kind, "add() did not return the set"); }
    let sum = 0, found = 0;
    for (let i = 0; i < n; i++) { sum += map.get(key(i)); found += set.has(key(i)) ? 1 : 0; }
    show(kind + " " + n, [map.size, set.size, sum, found, map.has(key(n)), set.has(key(n)), n <= 17 ? list(map) + " | " + members(set) : text([...map.keys()][n - 1])].join(" "));
  }
  const map = new Map(), set = new Set();
  for (let i = 0; i < 12; i++) { put(map, key(i), i); add(set, key(i)); }
  for (let i = 0; i < 12; i += 2) { map.delete(key(i)); set.delete(key(i)); }
  for (let i = 20; i < 26; i++) { put(map, key(i), i); add(set, key(i)); }
  for (let i = 0; i < 4; i += 2) { put(map, key(i), "back"); add(set, key(i)); }
  show(kind + ": deleted, added, added again", list(map) + " | " + members(set) + " | " + map.size + " " + set.size);
  for (let i = 0; i < 12; i++) put(map, key(i), "again"), add(set, key(i));
  show(kind + ": the same keys once more", list(map) + " | " + set.size);
  const copy = new Map(map), copied = new Set(set);
  for (let i = 40; i < 60; i++) { put(copy, key(i), i); add(copied, key(i)); }
  show(kind + ": a copy grows and the original does not", [map.size, copy.size, set.size, copied.size, copy.get(key(59)), map.has(key(59)), text([...copied][copied.size - 1])].join(" "));
  const walked = new Map([[key(0), 0]]), seen = [];
  for (const [k, v] of walked) { seen.push(v); if (v < 40) put(walked, key(v + 1), v + 1); }
  show(kind + ": added under a walk", seen.length + " " + seen[seen.length - 1]);
  const each = new Set([key(0)]); let count = 0;
  each.forEach(() => { if (++count < 40) add(each, key(count)); });
  show(kind + ": added under forEach", count + " " + each.size);
  map.clear(); set.clear();
  put(map, key(3), "after"); add(set, key(3));
  show(kind + ": after clear()", list(map) + " | " + members(set));
}
{
  const map = new Map(), set = new Set();
  for (const key of [0, -0, NaN, 0 / 0, 1, 1.0, "1", true, null, undefined, "", 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 1e300, Infinity, -Infinity, 10n, 10n, "a" + "b", "ab"]) { put(map, key, typeof key); add(set, key); }
  show("keys that are the same and keys that are not", list(map) + " | " + set.size);
  const rope = n => "left side of a rope " + n + " and the right side of it";
  for (let i = 0; i < 20; i++) { put(map, rope(i), i); put(map, rope(i), -i); }
  show("keys that are put together anew each time", map.size + " " + map.get(rope(19)));
}
{
  const kept = [];
  for (let round = 0; round < 200; round++) { const map = new Map(), set = new Set(); for (let i = 0; i < 7; i++) { put(map, { round, i }, [round, i]); add(set, { round, i }); } kept.push(map, set); }
  let sum = 0;
  for (const collection of kept) for (const entry of collection) sum += Array.isArray(entry) ? entry[0].i + entry[1][0] : entry.round;
  show("many small ones that are kept", sum);
}
{
  class Counting extends Map { set(key, value) { Counting.calls++; return super.set(key, value); } }
  Counting.calls = 0;
  const counting = new Counting();
  for (let i = 0; i < 5; i++) put(counting, i, i);
  const own = new Map(); own.set = function (key) { return "own " + key; };
  const other = new Set(); Object.setPrototypeOf(other, { add: key => "other " + key });
  show("set and add of their own", [Counting.calls, counting.size, put(own, 1, 2), own.size, add(other, 3)].join(" "));
  for (const receiver of [{}, [], new Set(), null, 1]) { try { Map.prototype.set.call(receiver, 1, 2); show("set on " + text(receiver), "no error"); } catch (error) { show("set on another receiver", error.constructor.name); } }
}
console.log(said.join("\n"));
