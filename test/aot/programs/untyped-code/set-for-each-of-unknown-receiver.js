// Set.prototype.forEach on receivers whose type the compiler does not know: the order of visits, what a callback may do to the set meanwhile, this, the errors.
const said = [];
const walk = (set, f, ...rest) => set.forEach(f, ...rest);
const show = (label, set, f) => { const seen = []; walk(set, (value, key, whole) => { seen.push(String(value) + (value === key || (value !== value && key !== key) ? "" : "!") + (whole === set ? "" : "?")); if (f) f(value, whole); }); said.push(label + ": " + seen.join(" ") + " | size " + set.size); };
const filled = n => { const set = new Set(); for (let i = 0; i < n; i++) set.add("k" + i); return set; };
const number = value => +value.slice(1);
show("empty", new Set());
show("fifteen", filled(15));
show("values of every kind", new Set([1, "1", NaN, -0, null, undefined, 1.5, 10n, Symbol.for("s"), true, 1, NaN, 0]));
show("the one visited is deleted", filled(6), (value, set) => set.delete(value));
show("the next one is deleted", filled(6), (value, set) => set.delete("k" + (number(value) + 1)));
show("an earlier one is deleted", filled(6), (value, set) => { if (number(value) > 1) set.delete("k" + (number(value) - 2)); });
show("values are added while fewer than twelve", filled(3), (value, set) => { if (set.size < 12) set.add("more" + set.size); });
show("deleted and added again", filled(4), (value, set) => { if (value === "k1") { set.delete("k0"); set.add("k0"); } });
show("cleared at the second", filled(5), (value, set) => { if (value === "k1") set.clear(); });
show("cleared and filled again", filled(5), (value, set) => { if (value === "k1") { set.clear(); set.add("new"); set.add("newer"); } });
show("grows far beyond its table", filled(2), (value, set) => { if (set.size < 300) for (let i = 0; i < 40; i++) set.add("g" + set.size); });
{
  const set = filled(3); const seen = [];
  walk(set, function () { "use strict"; seen.push(this === undefined ? "undefined" : typeof this); });
  walk(set, function () { seen.push(this.tag); }, { tag: "given" });
  walk(set, function () { "use strict"; seen.push(String(this)); }, 5);
  said.push("this: " + seen.join(" "));
}
{
  class Counted extends Set { constructor(values) { super(values); this.asked = 0; } has(value) { this.asked++; return super.has(value); } }
  const set = new Counted(["a", "b"]);
  show("a subclass", set); said.push("has was not asked: " + set.asked);
}
const attempt = f => { try { return "returns " + String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };
for (const receiver of [{}, [], new Map([[1, 1]]), new WeakSet(), null, undefined, 5, "text", Object.create(Set.prototype)])
  said.push("on " + (receiver === null ? "null" : Array.isArray(receiver) ? "an array" : typeof receiver === "object" ? receiver.constructor?.name ?? "an object" : typeof receiver) + ": " + attempt(() => Set.prototype.forEach.call(receiver, () => 0)));
for (const callback of [undefined, null, 5, "f", {}, class {}])
  said.push("callback " + (typeof callback === "function" ? "a class" : String(callback)) + ": " + attempt(() => walk(filled(1), callback)));
said.push("empty set, no function: " + attempt(() => walk(new Set(), undefined)));
said.push("the callback throws at the second: " + attempt(() => { let n = 0; walk(filled(4), () => { if (++n === 2) throw new RangeError("stop at " + n); }); }));
said.push("returns: " + attempt(() => walk(filled(2), () => 7)));
said.push("length and name: " + Set.prototype.forEach.length + " " + Set.prototype.forEach.name);
{
  const outer = filled(3); const seen = [];
  walk(outer, a => walk(outer, b => { seen.push(a + b); if (a === "k0" && b === "k1") outer.delete("k2"); }));
  said.push("nested over one set: " + seen.join(" "));
}
{
  let sum = 0; const many = [filled(1), filled(20), new Set([{}]), filled(200)];
  for (let round = 0; round < 200; round++) for (const set of many) walk(set, value => { sum += typeof value === "string" ? value.length : 1; });
  said.push("many rounds: " + sum);
}
console.log(said.join("\n"));
