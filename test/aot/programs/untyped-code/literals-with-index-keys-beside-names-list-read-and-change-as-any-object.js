// An object literal may have index keys beside its names. Such an object lists its keys, answers, is copied, frozen, walked and changed as any other object.
const show = value => JSON.stringify(value, (key, held) => typeof held === "function" ? "function" : held === undefined ? "undefined" : typeof held === "bigint" ? held + "n" : held);
function describe(label, object) {
  const descriptors = Object.getOwnPropertyDescriptors(object);
  const flags = Reflect.ownKeys(descriptors).map(key => String(key) + ":" + ["writable", "enumerable", "configurable"].map(flag => descriptors[key][flag] ? flag[0] : "-").join("")).join(" ");
  const walked = []; for (const key in object) walked.push(key);
  console.log(label + ": " + show(object) + " | " + Object.keys(object).join(",") + " | " + walked.join(",") + " | " + flags + " | " + Object.entries(object).length + " " + ("length" in object ? Array.prototype.join.call(object, "+") : "no length"));
}
const makers = {
  "names then indexes": n => ({ count: n, 2: "b", 3: "c", 4: n }),
  "indexes then names": n => ({ 0: n, 1: "one", count: n }),
  "mixed": n => ({ first: 1, 5: "five", second: n, 1: "one", third: 3, 0: n }),
  "an array-like": n => ({ length: 3, 0: n, 1: n + 0.5, 2: "two" }),
  "an array-like, the length last": n => ({ 0: "zero", 1: n, length: 2 }),
  "only indexes": n => ({ 0: "none", 1: n, 2: "two" }),
  "far apart": n => ({ name: n, 0: "near", 1000: "far", 100000: "farther" }),
  "the largest index and what is none": n => ({ name: n, 4294967294: "largest", 4294967295: "a name", "-1": "negative", "01": "padded", 1.5: "a fraction", 1e3: "a thousand" }),
  "the same index twice": n => ({ name: n, 1: "first", 1: "second", "1": n }),
  "computed": n => ({ name: n, [0]: "zero", [n & 1]: "computed", ["2"]: "text", [2 + 1]: "sum" }),
  "numbers alone": n => ({ size: 2, 0: n, 1: n + 1 }),
  "fractions alone": n => ({ size: 2, 0: n + 0.5, 1: 0.25 }),
  "numbers then text": n => ({ size: 2, 0: n, 1: "text", 2: null, 3: undefined, 4: { inner: n, 0: "deep" } }),
  "a getter under an index": n => ({ name: n, 0: "plain", get 1() { return this.name + 1; }, 2: "behind" }),
  "a setter under an index": n => ({ name: n, set 0(value) { this.name = value; }, 1: "behind" }),
  "a method under an index": n => ({ name: n, 0() { return this.name; }, 1: "behind" }),
  "a spread in front": n => ({ ...{ 1: "spread", other: 1 }, name: n, 0: "own", 1: "over" }),
  "a spread behind": n => ({ name: n, 0: "own", 1: "under", ...{ 1: "spread", 3: n } }),
  "a spread of a list": n => ({ name: n, 5: "own", ...["a", "b"] }),
  "a prototype in the literal": n => ({ __proto__: { 7: "inherited", kind: "above" }, name: n, 0: "own" }),
  "no prototype": n => ({ __proto__: null, name: n, 0: "own" }),
  "a symbol beside": n => ({ [Symbol.for("mark")]: n, name: n, 0: "own" }),
};
for (let round = 0; round < 4; round++) for (const label in makers) describe(label + " " + round, makers[label](round));
function attempt(label, work) { let said; try { said = show(work()); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
const make = n => ({ count: n, 2: "b", 3: "c" });
for (let round = 0; round < 3; round++) {
  attempt("read", () => { const o = make(round); return [o[2], o["3"], o[4], o[-1], o.count, o[1]]; });
  attempt("in and hasOwn", () => { const o = make(round); return [2 in o, "3" in o, 4 in o, Object.hasOwn(o, 2), Object.hasOwn(o, 4), o.hasOwnProperty("3"), o.propertyIsEnumerable(2)]; });
  attempt("stored over and beside", () => { const o = make(round); o[2] = "B"; o[4] = "d"; o[0] = "a"; o[10] = "far"; o.more = 1; return [o, Object.keys(o)]; });
  attempt("deleted", () => { const o = make(round); return [delete o[2], delete o[9], o, Object.keys(o), 2 in o]; });
  attempt("deleted and defined again", () => { const o = make(round); delete o[2]; o[2] = "again"; return [o, Object.keys(o)]; });
  attempt("frozen", () => { "use strict"; const o = Object.freeze(make(round)); try { o[2] = "B"; } catch (error) { return [error.constructor.name, o, Object.isFrozen(o)]; } return "stored"; });
  attempt("frozen, a new index", () => { "use strict"; const o = Object.freeze(make(round)); try { o[7] = "B"; } catch (error) { return [error.constructor.name, o]; } return "stored"; });
  attempt("sealed", () => { const o = Object.seal(make(round)); o[2] = "B"; o[7] = "no"; return [o, delete o[3], Object.isSealed(o)]; });
  attempt("not extensible", () => { const o = Object.preventExtensions(make(round)); o[2] = "B"; o[7] = "no"; return [o, delete o[3], o]; });
  attempt("redefined", () => { const o = make(round); Object.defineProperty(o, 2, { value: "fixed", writable: false }); o[2] = "B"; Object.defineProperty(o, 5, { get() { return this.count; }, enumerable: true }); return [o, Object.keys(o)]; });
  attempt("as a prototype", () => { const above = make(round); const below = Object.create(above); below[3] = "own"; return [below[2], below[3], above[3], Object.keys(below), 2 in below]; });
  attempt("as a prototype that changes", () => { const above = make(round); const below = Object.create(above); const before = below[5]; above[5] = "late"; return [before, below[5]]; });
  attempt("copied", () => { const o = make(round); return [{ ...o }, Object.assign({ 2: "under", 9: "kept" }, o), structuredClone(o), JSON.parse(JSON.stringify(o))]; });
  attempt("taken apart", () => { const { 2: two, count, ...rest } = make(round); return [two, count, rest]; });
  attempt("as a list", () => { const o = { length: 3, 0: round, 1: "one", 2: "two" }; return [Array.from(o), Array.prototype.map.call(o, value => value + "!"), Array.prototype.slice.call(o, 1), Array.prototype.indexOf.call(o, "two"), Array.prototype.push.call(o, "three"), o]; });
  attempt("applied", () => Math.max.apply(null, { length: 3, 0: round, 1: 7, 2: 3 }));
}
// A definition asks nothing above the object: neither an accessor nor a property that is read-only there. A store asks.
const calls = [];
const above = { kind: "above" };
Object.defineProperty(above, 2, { get() { calls.push("get"); return "above"; }, set(value) { calls.push("set " + value); }, configurable: true });
Object.defineProperty(above, 3, { value: "fixed above", writable: false, configurable: true });
const makeBelow = n => ({ __proto__: above, count: n, 2: "b", 3: "c" });
function storeBelow(n) { const o = { __proto__: above, count: n }; o[2] = "stored"; try { o[3] = "stored"; } catch (error) { calls.push(error.constructor.name); } o[4] = "own"; return o; }
for (let round = 0; round < 3; round++) {
  attempt("below an accessor and a fixed value", () => { const o = makeBelow(round); return [o, o[2], o[3], Object.keys(o), calls.length]; });
  attempt("a store below them", () => { const o = storeBelow(round); return [o, o[2], o[3], o[4], Object.keys(o), calls.join()]; });
}
const others = {
  "a view of bytes": () => new Uint8Array([7, 8]),
  "a text": () => new String("ab"),
  "a list": () => ["x", "y"],
  "a frozen list": () => Object.freeze(["x", "y"]),
  "a proxy": () => new Proxy({}, { set(target, key, value) { calls.push("trap " + String(key)); return true; } }),
  "an object below the accessor": () => Object.create(above),
};
for (let round = 0; round < 3; round++) {
  for (const label in others) {
    attempt("a store below " + label, () => {
      const o = { __proto__: others[label](), count: round };
      const said = [];
      for (const index of [0, 1, 2, 5]) { try { o[index] = "stored " + index; said.push(o[index]); } catch (error) { said.push(error.constructor.name); } }
      return [said, Object.keys(o), calls.length];
    });
  }
}
delete above[2];
delete above[3];
attempt("behind them", () => [makeBelow(9), storeBelow(9), calls.length]);
let sum = 0;
for (let i = 0; i < 20000; i++) { const o = { count: i, 2: "bb", 3: i, 4: "dddd" }; const list = { length: 2, 0: i, 1: 1 }; sum += o.count + o[2].length + o[3] + o[4].length + list[0] + list[1] + list.length; }
console.log(sum);
