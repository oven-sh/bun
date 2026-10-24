// Objects are made by literals in one function and get more names in another: once, several times, only sometimes; the keys stay in order, older objects stay what they were, and everything else done to such objects goes on working.
const collect = globalThis.gc ?? (() => globalThis.Bun.gc(true));
const show = value => JSON.stringify(value);
function two(i) { return { a: i, b: i + 1 }; }
function four(i) { return { a: i, b: i, c: i, d: i }; }
function one(i) { return { only: i }; }
function nested(i) { return { tag: "t" + i, attrs: { name: "n", content: i } }; }
function nullProto(i) { return { __proto__: null, p: i, q: i }; }
function oneOfFour(i) { switch (i & 3) { case 0: return { a: i, b: i }; case 1: return { p: i, q: i, r: i }; case 2: return { x: i, y: i, z: i, w: i }; default: return { m: i }; } }
function addKey(o, i) { o.key = i; return o; }
function addTwo(o, i) { o.key = i; o.more = -i; return o; }
function addMany(o, i) { for (const name of ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12", "n13", "n14", "n15", "n16", "n17", "n18", "n19"]) o[name] = i; return o; }
function addSometimes(o, i) { if (i % 3 === 0) o.third = i; if (i % 5 === 0) o.fifth = i; return o; }
function finish(tag, nonce, i) { tag.attrs.nonce = nonce; tag.key = "tag-" + i; return tag; }
const early = [two(0), four(0), one(0), nullProto(0), nested(0)];
const lines = [];
for (let i = 0; i < 40; i++) {
  lines.push(show([addKey(two(i), i), addTwo(four(i), i), addKey(addKey(one(i), i), i + 1), addSometimes(two(i), i), finish(nested(i), "x", i), addTwo(oneOfFour(i), i)]) + Object.keys(addTwo(nullProto(i), i)).join());
  if (i % 10 === 9) collect();
}
console.log(lines[0]); console.log(lines[1]); console.log(lines[15]); console.log(lines[39]); console.log(new Set(lines.map(line => line.replace(/-?\d+/g, "#"))).size);
console.log(show(early), show(early.map(o => Object.keys(o).length)), show(addKey(early[0], 9)), show(two(1)), Object.keys(two(1)).length);
console.log(show(addMany(two(1), 2)), Object.keys(addMany(four(1), 2)).length, show(Object.keys(addMany(one(1), 2)).slice(0, 4)));
const o = addTwo(two(5), 6); delete o.a; o.a = 7; console.log(show(o), show({ ...o, z: 1 }), show(Object.entries(addKey(two(1), 2))), show(Object.assign(two(1), { key: 3 })), "key" in two(1), Object.hasOwn(addKey(two(1), 1), "key"));
Object.defineProperty(addKey(two(1), 1), "hidden", { value: 1 }); Object.freeze(addKey(two(2), 2)); console.log(Object.isFrozen(two(3)), show(Object.getOwnPropertyDescriptor(addKey(two(4), 4), "key")));
for (const name in addTwo(two(1), 1)) lines.push(name); console.log(lines.slice(-4).join());
let sum = 0; const kept = [];
for (let i = 0; i < 200000; i++) { const made = addSometimes(addKey(oneOfFour(i), i), i); sum += Object.keys(made).length + made.key; if (i % 40000 === 0) { kept.push(made); collect(); } }
console.log(sum, show(kept));
