// Functions made at run time make objects from literals of every size, very many of them, across collections. What was never stored must not be there.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const empty = new Function("return {};");
const sized = [];
for (const size of [1, 2, 3, 5, 6, 7, 8, 12, 16, 31, 63, 64, 65, 100, 300]) sized.push([size, new Function("v", "return { " + Array.from({ length: size }, (_, i) => "k" + i + ": v + " + i).join(", ") + " };")]);
const nested = new Function("v", "return { value: v, issues: [], inner: { value: v, issues: [], inner: {} } };");
const later = new Function("v", "const made = {}; if (v % 2) made.odd = v; else made.even = v; return made;");
const withProto = new Function("p", "return { __proto__: p, own: 1 };");
const computed = new Function("k", "v", "return { [k]: v, fixed: 1 };");
const accessors = new Function("v", "return { get got() { return v; }, set got(x) { v = x; }, method() { return v; } };");
const spread = new Function("a", "b", "return { ...a, mid: 1, ...b };");

lines.push(JSON.stringify(empty()), String(Object.keys(empty()).length), String(Object.getPrototypeOf(empty()) === Object.prototype), String(empty() === empty()), String(Object.isExtensible(empty())));
for (const [size, make] of sized) {
  const made = make(10);
  const keys = Object.keys(made);
  lines.push(size + ": " + keys.length + " " + keys[0] + " " + keys[keys.length - 1] + " " + made.k0 + " " + made["k" + (size - 1)] + " " + made["k" + size] + " " + ("k" + size in made));
}
lines.push(JSON.stringify(nested(1)), JSON.stringify([later(1), later(2)]), JSON.stringify(computed("x", 2)), JSON.stringify(spread({ a: 1 }, { b: 2, mid: 3 })));
const parent = { inherited: "yes" };
lines.push(withProto(parent).inherited + " " + Object.keys(withProto(parent)) + " " + String(Object.getPrototypeOf(withProto(null))));
const pair = accessors(5);
pair.got = 6;
lines.push(pair.got + " " + pair.method());

const kept = [];
let sum = 0;
for (let turn = 0; turn < 200000; turn++) {
  const made = empty();
  for (const key in made) sum += 1000000;
  if (made.k0 !== undefined || made.value !== undefined) sum += 1000000;
  const other = nested(turn);
  sum += other.inner.value - other.value + other.issues.length + Object.keys(other.inner.inner).length;
  const [, make] = sized[turn % sized.length];
  const big = make(turn);
  sum += big.k0 - turn;
  if (turn % 5000 === 0) kept.push(made, other, big);
  if (turn % 50000 === 49999) collect();
  made.filled = turn;
}
collect();
lines.push("sum " + sum, String(kept.length), JSON.stringify(kept[0]), JSON.stringify(kept[1]), String(Object.keys(kept[kept.length - 1]).length), JSON.stringify(kept[kept.length - 3]));
console.log(lines.join("\n"));
