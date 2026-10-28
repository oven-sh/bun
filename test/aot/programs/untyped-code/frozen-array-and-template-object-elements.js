// Elements read by index from arrays that keep them out of the ordinary places: the strings of tagged templates (frozen, with a `raw` beside them), arrays frozen with a name on them, arrays with one element made
// read-only, sparse arrays, arrays that were shifted, heirs of Array; and what may still change in each of them does: an element that is only read-only is redefined, one that is only fixed in place is stored to,
// a length is cut, an accessor answers anew each time. Collections come between. Once warm, the strings of a template are read without asking the engine. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
function tag(strings, ...values) { let text = ""; for (let i = 0; i < strings.length; i++) text += strings[i] + (i < values.length ? "[" + values[i] + "]" : ""); return text; }
function raw(strings) { let text = ""; for (let i = 0; i < strings.raw.length; i++) text += strings.raw[i] + "|"; return text; }
function same(strings) { return strings; }
const page = (a, b) => tag`<p>${a}</p>\n<b>${b}</b>tail`;
lines.push(page(1, 2), raw`a\n${1}b\t${2}c`, tag``, tag`${1}`, tag`only`, tag`\unicode and ${"an invalid escape"}`.length);
const one = () => same`x${0}y${1}z`;
lines.push(one() === one(), Object.isFrozen(one()), Object.isFrozen(one().raw), one().length, one()[3], one()[-1], one()["1"], one()[1.5], 2 in one(), 3 in one());
lines.push(attempt(() => { "use strict"; one()[0] = "changed"; }), one()[0], attempt(() => { "use strict"; one().push("more"); }), attempt(() => { "use strict"; one().length = 0; }), attempt(() => { "use strict"; delete one()[1]; }), one().join());
function read(list, n) { let text = ""; for (let i = 0; i < n; i++) text += String(list[i]) + ","; return text; }
const named = Object.assign(["a", "b", "c"], { name: "named" });
lines.push(read(named, 4));
Object.freeze(named);
lines.push(read(named, 4), read(named, 4), named.name, attempt(() => { "use strict"; named[1] = "B"; }), read(named, 4));
const readOnly = ["a", "b", "c"];
Object.defineProperty(readOnly, 1, { value: "fixed value, may be redefined", writable: false });
lines.push(read(readOnly, 4), read(readOnly, 4));
Object.defineProperty(readOnly, 1, { value: "redefined" });
lines.push(read(readOnly, 4));
readOnly[0] = "A"; readOnly[2] = "C";
lines.push(read(readOnly, 4));
readOnly.length = 1;
lines.push(read(readOnly, 4));
const inPlace = ["a", "b", "c"];
Object.defineProperty(inPlace, 1, { value: "stays in place, may be stored to", configurable: false });
lines.push(read(inPlace, 4), read(inPlace, 4));
inPlace[1] = "stored";
lines.push(read(inPlace, 4), attempt(() => { "use strict"; inPlace.length = 0; }), read(inPlace, 4));
const forGood = ["a", "b", "c"];
Object.defineProperty(forGood, 1, { value: "for good", writable: false, configurable: false });
lines.push(read(forGood, 4), read(forGood, 4));
forGood[0] = "A"; forGood[2] = "C"; forGood[3] = "D";
lines.push(read(forGood, 5), attempt(() => { "use strict"; forGood[1] = "no"; }), attempt(() => { "use strict"; forGood.length = 0; }), read(forGood, 5), forGood.length);
let asked = 0;
const answers = ["a", "b"];
Object.defineProperty(answers, 1, { get() { return ++asked; }, configurable: false });
lines.push(read(answers, 3), read(answers, 3));
const sparse = ["a"]; sparse[70000] = "far"; sparse[5] = "five";
lines.push(read(sparse, 7), sparse[70000], sparse[69999]);
Object.freeze(sparse);
lines.push(read(sparse, 7), sparse[70000], sparse[69999], read(sparse, 7), sparse[70000]);
const shifted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; shifted.shift(); shifted.unshift("front"); shifted.unshift("more");
lines.push(read(shifted, 12)); shifted[3] = "stored"; delete shifted[4]; lines.push(read(shifted, 12));
class Heir extends Array {}
const heir = Heir.from(["x", "y", "z"]);
lines.push(read(heir, 4)); heir[1] = "Y"; heir.pop(); lines.push(read(heir, 4)); Object.freeze(heir); lines.push(read(heir, 4), read(heir, 4));
const object = { 0: "zero", 1: "one", length: 2 }; object[100000] = "far";
lines.push(read(object, 3)); Object.freeze(object); lines.push(read(object, 3), read(object, 3), object[100000]);
Array.prototype; const holes = [, "b", , "d"]; Object.freeze(holes);
lines.push(read(holes, 5), read(holes, 5));
function churn(n) { const kept = []; for (let i = 0; i < n; i++) { const list = Object.assign(["k" + i, i], { tag: i }); Object.freeze(list); if (read(list, 2) !== "k" + i + "," + i + ",") lines.push("wrong at " + i); if (i % 97 === 0) kept.push(list); } return kept.map(list => read(list, 2)).join("").length; }
lines.push(churn(20000));
for (let i = 0; i < 300; i++) page(i, i + 1);
const before = count("operationAOTGetByVal");
let length = 0;
for (let i = 0; i < 5000; i++) length += page(i, i + 1).length + read(named, 3).length;
lines.push("the engine is asked at most 600 times for 30000 elements: " + (count("operationAOTGetByVal") - before <= 600), length);
console.log(lines.join("\n"));
