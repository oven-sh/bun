// for..of over x.keys(), x.values() and x.entries(), and over pairs that the loop takes apart at once, where the compiler does not know what x is.
const said = [];
const text = value => Array.isArray(value) ? "[" + value.map(text).join(",") + "]" : typeof value === "object" && value !== null ? "{" + Object.keys(value).join(",") + "}" : String(value);
const show = (label, result) => said.push(label + ": " + result);
const attempt = (label, f) => { try { show(label, f()); } catch (error) { show(label, error.constructor.name); } };
const keys = (x, body) => { const seen = []; for (const key of x.keys()) { seen.push(text(key)); if (body && body(key, x) === "stop") break; } return seen.join(" "); };
const values = (x, body) => { const seen = []; for (const value of x.values()) { seen.push(text(value)); if (body && body(value, x) === "stop") break; } return seen.join(" "); };
const entries = (x, body) => { const seen = []; for (const entry of x.entries()) { seen.push(text(entry)); if (body && body(entry, x) === "stop") break; } return seen.join(" "); };
const apart = (x, body) => { const seen = []; for (const [key, value] of x.entries()) { seen.push(text(key) + "=" + text(value)); if (body && body(key, value, x) === "stop") break; } return seen.join(" "); };
const pairs = (x, body) => { const seen = []; for (const [key, value] of x) { seen.push(text(key) + "=" + text(value)); if (body && body(key, value, x) === "stop") break; } return seen.join(" "); };
const firsts = x => { const seen = []; for (const [key] of x) seen.push(text(key)); return seen.join(" "); };
const seconds = x => { const seen = []; for (const [, value] of x) seen.push(text(value)); return seen.join(" "); };
const three = x => { const seen = []; for (const [key, value, more] of x) seen.push(text(key) + text(value) + text(more)); return seen.join(" "); };
const defaults = x => { const seen = []; for (const [key = "no key", value = "no value"] of x) seen.push(text(key) + "=" + text(value)); return seen.join(" "); };
const assigned = x => { let key, value; const seen = []; for ([key, value] of x) seen.push(text(key) + "=" + text(value)); return seen.join(" ") + " then " + text(key); };
const every = [["keys", keys], ["values", values], ["entries", entries], ["entries apart", apart]];
const mapOf = (n, key = i => "k" + i) => { const map = new Map(); for (let i = 0; i < n; i++) map.set(key(i), i); return map; };
const setOf = (n, key = i => "k" + i) => { const set = new Set(); for (let i = 0; i < n; i++) set.add(key(i)); return set; };
const kinds = { strings: i => "k" + i, numbers: i => i * 7, mixed: i => i % 2 ? i : "k" + i };

for (const [kind, key] of Object.entries(kinds)) {
  for (const n of [0, 1, 5, 20]) for (const [name, walk] of every) show(kind + " " + n + " " + name, walk(mapOf(n, key)) + " | " + walk(setOf(n, key)));
  for (const [name, walk] of every) {
    let turns = 0;
    show(kind + " " + name + ": all are deleted at the second", walk(mapOf(6, key), (a, b, c) => { const map = c ?? b; if (++turns === 2) for (let i = 0; i < 6; i++) map.delete(key(i)); }));
    show(kind + " " + name + ": it grows up to twenty-five", walk(mapOf(2, key), (a, b, c) => { const map = c ?? b; if (map.size < 25) map.set(key(map.size), map.size); }));
    show(kind + " " + name + ": cleared and filled again", walk(mapOf(4, key), (a, b, c) => { const map = c ?? b; if (map.size === 4) { map.clear(); map.set(key(8), 8); map.set(key(9), 9); map.set(key(10), 10); } }));
    show(kind + " " + name + ": a set grows up to twenty-five", walk(setOf(2, key), (a, b, c) => { const set = c ?? b; if (set.size < 25) set.add(key(set.size)); }));
    show(kind + " " + name + ": left at once", walk(mapOf(3, key), () => "stop") + " | " + walk(setOf(3, key), () => "stop"));
  }
  for (const [name, walk] of [["pairs", pairs], ["firsts", firsts], ["seconds", seconds], ["three", three], ["defaults", defaults], ["assigned", assigned]]) show(kind + " " + name, walk(mapOf(5, key)) + " | " + walk(mapOf(0, key)) + " | " + walk(mapOf(3, key).entries()) + " | " + walk(setOf(3, key).entries()) + " | " + walk(Object.entries({ a: 1, b: 2 })) + " | " + walk([[1, 2, 3], [4], [], "xy", new Set([5, 6])]));
  show(kind + " pairs: the one visited is deleted", pairs(mapOf(6, key), (k, v, map) => { map.delete(k); }));
  show(kind + " pairs: it grows up to thirty", pairs(mapOf(3, key), (k, v, map) => { if (map.size < 30) map.set(key(map.size), map.size); }));
  show(kind + " pairs: cleared and filled again", pairs(mapOf(5, key), (k, v, map) => { if (v === 1) { map.clear(); map.set(key(7), "n"); } }));
}
show("values that are undefined or holes", defaults(new Map([["a", undefined], [undefined, "b"], [null, null]])) + " | " + defaults([[undefined, 1], [, 2], [3]]));
show("values of every kind", pairs(new Map([["a", undefined], ["b", null], ["c", 0], ["d", 1.5], ["e", "text"], ["f", true], ["g", 2 ** 40], ["h", [1]], ["i", { x: 1 }], ["j", 10n]])));
{
  const seen = [], map = mapOf(3);
  for (const [a, x] of map) for (const [b, y] of map.entries()) for (const c of map.keys()) seen.push(a + b + c + (x + y));
  show("three walks of one map within each other", seen.length + " " + seen[0] + " " + seen[26]);
  const closures = [];
  for (const [key, value] of mapOf(3)) closures.push(() => key + value);
  show("every turn has its own names", closures.map(f => f()).join(" "));
}
for (const [name, walk] of every) {
  show(name + " of arrays and others", [walk([]), walk(["a", "b"]), walk([1, , 3]), walk(new Uint8Array([7, 8])), walk({ keys: () => [1], values: () => "ab", entries: () => new Map([[1, 2]]) })].join(" | "));
  const own = mapOf(2);
  own.keys = own.values = () => ["own"]; own.entries = () => [["own", "own"]];
  class Other extends Map { keys() { return ["other"]; } values() { return ["other"]; } entries() { return [["other", "other"]]; } }
  class Same extends Set {}
  const moved = setOf(2);
  Object.setPrototypeOf(moved, { keys: () => ["moved"], values: () => ["moved"], entries: () => [["moved", "moved"]] });
  const between = mapOf(2);
  Object.setPrototypeOf(between, Object.create(Map.prototype, { keys: { value: () => ["between"] }, values: { value: () => ["between"] }, entries: { value: () => [["between", 1]] } }));
  const labelled = mapOf(2); labelled.label = 1;
  show(name + " of maps and sets that are not as they were made", [walk(own), walk(new Other([[1, 2]])), walk(new Same([1, 2])), walk(moved), walk(between), walk(labelled)].join(" | "));
  for (const nothing of [undefined, null, 1, {}, { keys: 1, values: 1, entries: 1 }, { keys: () => 1, values: () => undefined, entries: () => ({}) }, Object.setPrototypeOf(mapOf(1), null)]) attempt(name + " of " + text(nothing), () => walk(nothing));
}
{
  const order = [], receiver = () => { order.push("receiver"); return { get values() { order.push("read"); return function () { order.push("call " + (this === held)); return { [Symbol.iterator]() { order.push("open"); return { next() { order.push("next"); return { done: true }; } }; } }; }; } }; };
  let held;
  for (const value of (held = receiver()).values()) order.push("body");
  show("the order of what a loop does", order.join(" "));
  const where = error => (error.stack.split("\n").find(line => /:\d+:\d+/.test(line)) ?? "").replace(/^.*?(\d+:\d+)\)?$/, "$1");
  let first, second;
  try {
    for (const value of ({}).values()) said.push(value);
  } catch (error) { first = where(error); }
  try {
    ({}).values();
  } catch (error) { second = where(error); }
  show("an error says where", first.split(":")[0] - second.split(":")[0]);
}
console.log(said.join("\n"));
