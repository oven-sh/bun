// `for..in` over objects that have lost a property, have one that is not enumerable, an accessor, a symbol; made with names that are written and with names that are put together; with and without a prototype that has enumerable names, some of them hidden by the object's own. In each loop, at each step, the object is changed in one way: which keys are still visited, in which order, the first time and once the same kind of object has been walked often.
const mark = Symbol("mark");
const word = text => text.split("").join("");
const makers = {
  "written": () => { const o = {}; o.a = 1; o.b = 2; o.c = 3; o.d = 4; return o; },
  "written, one deleted": () => { const o = {}; o.a = 1; o.x = 0; o.b = 2; o.c = 3; o.d = 4; delete o.x; return o; },
  "written, one hidden": () => { const o = {}; o.a = 1; Object.defineProperty(o, "h", { value: 9, enumerable: false, writable: true, configurable: true }); o.b = 2; o.c = 3; o.d = 4; return o; },
  "written, an accessor": () => { const o = {}; o.a = 1; Object.defineProperty(o, "b", { get() { return 2; }, enumerable: true, configurable: true }); o.c = 3; o.d = 4; return o; },
  "written, a hidden accessor": () => { const o = {}; o.a = 1; Object.defineProperty(o, "h", { get() { return 2; }, enumerable: false, configurable: true }); o.b = 2; o.c = 3; o.d = 4; return o; },
  "written, a symbol": () => { const o = {}; o.a = 1; o[mark] = 5; o.b = 2; o.c = 3; o.d = 4; return o; },
  "a literal with a getter": () => ({ a: 1, get b() { return 2; }, c: 3, d: 4 }),
  "put together": () => { const o = { __proto__: null }; for (const k of ["a", "b", "c", "d"]) o[word(k)] = 1; return o; },
  "put together, one deleted": () => { const o = { __proto__: null }; for (const k of ["a", "x", "b", "c", "d"]) o[word(k)] = 1; delete o[word("x")]; return o; },
  "put together, one hidden": () => { const o = { __proto__: null }; for (const k of ["a", "h", "b", "c", "d"]) o[word(k)] = 1; Object.defineProperty(o, word("h"), { enumerable: false }); return o; },
  "put together, an accessor": () => { const o = { __proto__: null }; for (const k of ["a", "b", "c", "d"]) o[word(k)] = 1; Object.defineProperty(o, word("b"), { get() { return 2; }, enumerable: true, configurable: true }); return o; },
  "below names": () => { const o = Object.create({ p: 1, c: 0, q: 2 }); o.a = 1; o.b = 2; o.c = 3; o.d = 4; return o; },
  "below names, one of them hidden by its own": () => { const o = Object.create({ p: 1, h: 0, q: 2 }); o.a = 1; Object.defineProperty(o, "h", { value: 9, enumerable: false, writable: true, configurable: true }); o.b = 2; o.c = 3; o.d = 4; return o; },
  "below names, one deleted": () => { const o = Object.create({ p: 1, x: 0, q: 2 }); o.a = 1; o.x = 5; o.b = 2; o.c = 3; o.d = 4; delete o.x; return o; },
};
const changes = {
  "nothing": () => {},
  "the next is deleted": (o, k, keys) => { delete o[keys[keys.indexOf(k) + 1]]; },
  "the last is deleted": o => { delete o.d; },
  "the one before is deleted": (o, k, keys) => { delete o[keys[keys.indexOf(k) - 1]]; },
  "this one is deleted": (o, k) => { delete o[k]; },
  "deleted and put back": o => { delete o.c; o.c = 7; },
  "one is added": o => { o.z = 1; },
  "the next is hidden": (o, k, keys) => { const next = keys[keys.indexOf(k) + 1]; if (next !== undefined && Object.hasOwn(o, next)) Object.defineProperty(o, next, { enumerable: false }); },
  "the last becomes an accessor": o => { Object.defineProperty(o, "d", { get() { return 4; }, enumerable: true, configurable: true }); },
  "the hidden one is shown": o => { if (Object.hasOwn(o, "h")) Object.defineProperty(o, "h", { enumerable: true }); },
  "the hidden one is deleted": o => { delete o.h; },
  "another prototype": o => { Object.setPrototypeOf(o, { r: 1, d: 2 }); },
  "no prototype": o => { Object.setPrototypeOf(o, null); },
  "an element": o => { o[0] = 1; },
  "frozen": o => { Object.freeze(o); },
  "a value is stored": o => { o.c = "text"; },
  "a symbol is added": o => { o[Symbol.for("late")] = 1; },
};
function walk(o, step, change) {
  const keys = [];
  for (const k in o) keys.push(k);
  const seen = [];
  let at = 0;
  for (const k in o) { seen.push(k); if (at++ === step) change(o, k, keys); }
  const after = [];
  for (const k in o) after.push(k);
  return keys.join("") + " " + seen.join("") + " " + after.join("");
}
// The same walk as a text that is put together while the program runs.
const walkAsText = new Function("o", "step", "change", word('const keys = []; for (const k in o) keys.push(k); const seen = []; let at = 0; for (const k in o) { seen.push(k); if (at++ === step) change(o, k, keys); } const after = []; for (const k in o) after.push(k); return keys.join("") + " " + seen.join("") + " " + after.join("");'));
const said = new Map();
for (let round = 0; round < 40; round++) {
  for (const made in makers) {
    for (const changed in changes) {
      for (let step = 0; step < 4; step++) {
        const line = made + ", " + changed + " at " + step + ": " + walk(makers[made](), step, changes[changed]);
        said.set(line, (said.get(line) ?? 0) + 1);
        if (round % 8 === 7 && walkAsText(makers[made](), step, changes[changed]) !== line.slice(line.indexOf(": ") + 2)) said.set("the text disagrees: " + line, 1);
      }
    }
  }
}
// A getter that is called for the value changes the object.
for (let round = 0; round < 40; round++) {
  const o = { a: 1, get b() { delete this.c; return 2; }, c: 3, d: 4 };
  const seen = [];
  for (const k in o) seen.push(k + o[k]);
  const line = "a getter deletes the next: " + seen.join();
  said.set(line, (said.get(line) ?? 0) + 1);
}
const lines = [...said].map(([line, times]) => times + " " + line);
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, sum);
console.log(lines.filter((_, i) => i % 41 === 0).join("\n"));
