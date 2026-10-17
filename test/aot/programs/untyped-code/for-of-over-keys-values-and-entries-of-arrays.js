// for..of over x.keys(), x.values() and x.entries() where x turns out to be an array: every kind of storage, holes, and what the body may do to the array meanwhile.
const said = [];
const text = value => Array.isArray(value) ? "[" + value.map(text).join(",") + "]" : typeof value === "object" && value !== null ? "{" + Object.keys(value).join(",") + "}" : Object.is(value, -0) ? "-0" : String(value);
const show = (label, result) => said.push(label + ": " + result);
const keys = (x, body) => { const seen = []; for (const key of x.keys()) { seen.push(text(key)); if (body && body(key, x[key], x) === "stop") break; } return seen.join(" "); };
const values = (x, body) => { const seen = []; let at = 0; for (const value of x.values()) { seen.push(text(value)); if (body && body(at++, value, x) === "stop") break; } return seen.join(" "); };
const entries = (x, body) => { const seen = []; for (const entry of x.entries()) { seen.push(text(entry)); if (body && body(entry[0], entry[1], x) === "stop") break; } return seen.join(" "); };
const apart = (x, body) => { const seen = []; for (const [index, value] of x.entries()) { seen.push(text(index) + "=" + text(value)); if (body && body(index, value, x) === "stop") break; } return seen.join(" "); };
const indexes = x => { const seen = []; for (const [index] of x.entries()) seen.push(typeof index + index); return seen.join(" "); };
const every = [["keys", keys], ["values", values], ["entries", entries], ["entries apart", apart]];
const made = {
  empty: () => [], integers: () => [1, 2, 3], doubles: () => [1.5, 2.5, -0, NaN], mixed: () => [1, "a", null, undefined, { x: 1 }, [2]], "integers with a hole": () => [1, , 3], "doubles with a hole": () => [1.5, , 3.5],
  "mixed with holes": () => ["a", , , "d"], "nothing but holes": () => Array(3), filled: () => Array(3).fill(7), pushed: () => { const a = []; for (let i = 0; i < 20; i++) a.push(i * i); return a; },
  sparse: () => { const a = [1, 2]; a[5000] = 3; return a.slice(0, 3).concat(a.slice(4999)); }, "with array storage": () => { const a = [1, 2, 3]; a[100000] = 4; a.length = 4; return a; }, frozen: () => Object.freeze([1, 2]), sealed: () => Object.seal(["a"]),
  "integers that became doubles": () => { const a = [1, 2]; a.push(2.5); return a; }, "doubles that became anything": () => { const a = [1.5]; a.push("x"); return a; }, "a length set by hand": () => { const a = [1, 2, 3, 4]; a.length = 2; return a; }, "a longer length set by hand": () => { const a = [1]; a.length = 3; return a; },
};
for (const [kind, make] of Object.entries(made)) for (const [name, walk] of every) show(kind + " " + name, walk(make()));
show("the index is a number", indexes(["a", "b"]) + " | " + indexes([1.5]) + " | " + indexes([]));
for (const [name, walk] of every) {
  show(name + ": it grows up to eight", walk([0], (i, v, a) => { if (a.length < 8) a.push(a.length); }));
  show(name + ": it shrinks", walk([0, 1, 2, 3, 4, 5], (i, v, a) => { a.pop(); }));
  show(name + ": it is emptied at the second", walk([0, 1, 2, 3], (i, v, a) => { if (i === 1) a.length = 0; }));
  show(name + ": emptied and filled again", walk([0, 1, 2, 3], (i, v, a) => { if (i === 1) { a.length = 0; a.push("a", "b", "c", "d", "e"); } }));
  show(name + ": what lies ahead is replaced", walk([0, 1, 2, 3], (i, v, a) => { if (i + 1 < a.length) a[i + 1] = "r" + i; }));
  show(name + ": integers become doubles", walk([0, 1, 2, 3], (i, v, a) => { if (i === 1) a[3] = 3.5; }));
  show(name + ": doubles become anything", walk([0.5, 1.5, 2.5, 3.5], (i, v, a) => { if (i === 1) a[3] = "text"; }));
  show(name + ": what lies ahead is deleted", walk([0, 1, 2, 3], (i, v, a) => { delete a[i + 1]; }));
  show(name + ": it becomes sparse", walk([0, 1, 2], (i, v, a) => { if (i === 0) { a[200000] = "far"; a.length = 4; } }));
  show(name + ": shifted", walk([0, 1, 2, 3, 4, 5], (i, v, a) => { a.shift(); }));
  show(name + ": an element becomes an accessor", walk([0, 1, 2, 3], (i, v, a) => { if (i === 0) Object.defineProperty(a, 2, { get: () => "got", configurable: true }); }));
  show(name + ": it is given an iterator of its own", walk([0, 1, 2], (i, v, a) => { if (i === 0) a[Symbol.iterator] = function* () { yield "own"; }; }));
  show(name + ": it is given methods of its own", walk([0, 1, 2], (i, v, a) => { if (i === 0) a.keys = a.values = a.entries = () => ["own"]; }));
  show(name + ": it is put under another prototype", walk([0, , 2], (i, v, a) => { if (i === 0) Object.setPrototypeOf(a, { 1: "inherited" }); }));
  show(name + ": it is frozen", walk([0, 1, 2], (i, v, a) => { if (i === 0) Object.freeze(a); }));
  show(name + ": left at the second", walk([0, 1, 2], i => i === 1 ? "stop" : undefined));
  const own = [1, 2]; own.keys = own.values = () => ["own"]; own.entries = () => [["own", "own"]];
  class Other extends Array { keys() { return ["other"]; } values() { return ["other"]; } entries() { return [["other", "other"]]; } }
  class Same extends Array {}
  const moved = [1, 2]; Object.setPrototypeOf(moved, { keys: () => ["moved"], values: () => ["moved"], entries: () => [["moved", "moved"]] });
  const between = [1, , 3]; Object.setPrototypeOf(between, Object.create(Array.prototype, { 1: { value: "between" } }));
  const labelled = [1, 2]; labelled.label = 1;
  const iterated = [1, 2]; iterated[Symbol.iterator] = function* () { yield "its own iterator is not asked"; };
  show(name + " of arrays that are not as they were made", [walk(own), walk(Other.of(1)), walk(Same.of(1, 2)), walk(moved), walk(between), walk(labelled), walk(iterated)].join(" | "));
}
{
  const kept = [];
  for (const entry of ["a", "b"].entries()) kept.push(entry);
  kept[0].push("more");
  show("every entry is an array of its own", [kept[0] !== kept[1], text(kept), Object.getPrototypeOf(kept[1]) === Array.prototype].join(" "));
  const seen = [], array = ["x", "y"];
  for (const [i, a] of array.entries()) for (const [j, b] of array.entries()) for (const k of array.keys()) seen.push(i + a + j + b + k);
  show("three walks of one array within each other", seen.join(" "));
  const closures = [];
  for (const [index, value] of ["p", "q"].entries()) closures.push(() => index + value);
  show("every turn has its own names", closures.map(f => f()).join(" "));
  let sum = 0;
  const large = Array.from({ length: 70000 }, (_, i) => i);
  for (const [index, value] of large.entries()) sum += index - value + 1;
  for (const index of large.keys()) sum += index & 1;
  show("a large one", sum);
}
console.log(said.join("\n"));
