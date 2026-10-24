// Map.prototype.forEach on receivers whose type the compiler does not know: the order of visits, what a callback may do to the map meanwhile, this, the errors.
const said = [];
const walk = (map, f, ...rest) => map.forEach(f, ...rest);
const show = (label, map, f) => { const seen = []; walk(map, (value, key, whole) => { seen.push(String(key) + "=" + String(value) + (whole === map ? "" : "?")); if (f) f(value, key, whole); }); said.push(label + ": " + seen.join(" ") + " | size " + map.size); };
const filled = n => { const map = new Map(); for (let i = 0; i < n; i++) map.set("k" + i, i); return map; };
show("empty", new Map());
show("fifteen", filled(15));
show("keys of every kind", new Map([[1, "one"], ["1", "text"], [NaN, "nan"], [-0, "zero"], [null, "null"], [undefined, "undefined"], [1.5, "half"], [10n, "big"], [Symbol.for("s"), "symbol"], [true, "true"]]));
show("the one visited is deleted", filled(6), (value, key, map) => map.delete(key));
show("the next one is deleted", filled(6), (value, key, map) => map.delete("k" + (value + 1)));
show("an earlier one is deleted", filled(6), (value, key, map) => { if (value > 1) map.delete("k" + (value - 2)); });
show("entries are added while fewer than twelve", filled(3), (value, key, map) => { if (map.size < 12) map.set("more" + map.size, map.size); });
show("deleted and added again", filled(4), (value, key, map) => { if (value === 1) { map.delete("k0"); map.set("k0", "again"); } });
show("cleared at the second", filled(5), (value, key, map) => { if (value === 1) map.clear(); });
show("cleared and filled again", filled(5), (value, key, map) => { if (value === 1) { map.clear(); map.set("new", "n"); map.set("newer", "m"); } });
show("grows far beyond its table", filled(2), (value, key, map) => { if (map.size < 300) for (let i = 0; i < 40; i++) map.set("g" + map.size, 0); });
show("a value is replaced ahead", filled(4), (value, key, map) => { if (value === 0) map.set("k3", "replaced"); });
{
  const map = filled(3); const seen = [];
  walk(map, function (value) { "use strict"; seen.push(this === undefined ? "undefined" : typeof this + ":" + String(this.tag ?? this)); });
  walk(map, function (value) { seen.push(this.tag); }, { tag: "given" });
  walk(map, function () { "use strict"; seen.push(String(this)); }, 5);
  said.push("this: " + seen.join(" "));
}
{
  class Counted extends Map { constructor(entries) { super(entries); this.reads = 0; } get(key) { this.reads++; return super.get(key); } }
  const map = new Counted([["a", 1], ["b", 2]]);
  show("a subclass", map); said.push("get was not asked: " + map.reads);
}
const attempt = f => { try { return "returns " + String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };
for (const receiver of [{}, [], new Set([1]), new WeakMap(), null, undefined, 5, "text", Object.create(Map.prototype)])
  said.push("on " + (receiver === null ? "null" : Array.isArray(receiver) ? "an array" : typeof receiver === "object" ? receiver.constructor?.name ?? "an object" : typeof receiver) + ": " + attempt(() => Map.prototype.forEach.call(receiver, () => 0)));
for (const callback of [undefined, null, 5, "f", {}, class {}])
  said.push("callback " + (typeof callback === "function" ? "a class" : String(callback)) + ": " + attempt(() => walk(filled(1), callback)));
said.push("empty map, no function: " + attempt(() => walk(new Map(), undefined)));
said.push("the callback throws at the second: " + attempt(() => { let n = 0; walk(filled(4), () => { if (++n === 2) throw new RangeError("stop at " + n); }); }));
said.push("returns: " + attempt(() => walk(filled(2), () => 7)));
said.push("length and name: " + Map.prototype.forEach.length + " " + Map.prototype.forEach.name);
{
  const outer = filled(3); const seen = [];
  walk(outer, (a, ka) => walk(outer, (b, kb) => { seen.push(ka + kb); if (ka === "k0" && kb === "k1") outer.delete("k2"); }));
  said.push("nested over one map: " + seen.join(" "));
}
{
  let sum = 0; const many = [filled(1), filled(20), new Map([[{}, 1]]), filled(200)];
  for (let round = 0; round < 200; round++) for (const map of many) walk(map, value => { sum += value; });
  said.push("many rounds: " + sum);
}
console.log(said.join("\n"));
